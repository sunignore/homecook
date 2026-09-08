-- Validated recipe, ingredient and private-photo repository.
create table public.cloud_recipe_commands(
 household_id uuid not null references public.cloud_households,
 user_id uuid not null references public.cloud_members,
 command_id uuid not null, kind text not null,
 request jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(household_id,user_id,command_id),
 foreign key(household_id,user_id) references public.cloud_members(household_id,user_id),
 check(kind in('recipe-save','recipe-delete','photo-begin','photo-finalize','photo-abort'))
);
alter table public.cloud_recipe_commands enable row level security;
revoke all on public.cloud_recipe_commands from public,anon,authenticated;
grant all on public.cloud_recipe_commands to service_role;
create unique index cloud_ingredient_live_name on public.cloud_ingredients(
 household_id,lower(regexp_replace(trim(name),'\s+','','g'))) where deleted_at is null;

create function public.cloud_json_exact(value jsonb,expected_keys text[]) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='object' and
 (select array_agg(key order by key) from jsonb_object_keys(value) key)=
 (select array_agg(key order by key) from unnest(expected_keys) key)
$$;
revoke all on function public.cloud_json_exact(jsonb,text[]) from public,anon,authenticated;

create function public.cloud_recipe_snapshot() returns jsonb
language sql stable security definer set search_path='' as $$
 with current_home as(select public.cloud_household() id)
 select case when h.id is null then null else jsonb_build_object(
  'householdId',h.id,'revision',coalesce(rv.revision,0),
  'ingredients',coalesce((select jsonb_agg(jsonb_build_object(
   'id',i.id,'name',i.name,'aliases',i.aliases,'category',i.category,'defaultUnit',i.default_unit,
   'isStaple',i.is_staple,'version',i.version,'createdAt',i.created_at,'updatedAt',i.updated_at)
   order by lower(i.name),i.id) from public.cloud_ingredients i
   where i.household_id=h.id and i.deleted_at is null),'[]'::jsonb),
  'photos',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'objectPath',p.object_path,'sha256',p.sha256,'mimeType',p.mime_type,
   'byteSize',p.byte_size,'version',p.version,'createdAt',p.created_at,'updatedAt',p.updated_at)
   order by p.id) from public.cloud_photos p where p.household_id=h.id
   and p.state='ready' and p.deleted_at is null),'[]'::jsonb),
  'recipes',coalesce((select jsonb_agg(jsonb_build_object(
   'id',r.id,'title',r.title,'servings',r.servings,'sourceUrl',r.source_url,
   'sourceText',r.source_text,'notes',r.notes,'tags',r.tags,'steps',r.steps,
   'photoId',r.photo_id,'orderable',r.orderable,'version',r.version,
   'createdAt',r.created_at,'updatedAt',r.updated_at,
   'ingredients',coalesce((select jsonb_agg(jsonb_build_object(
    'ingredientId',ri.ingredient_id,'qty',ri.qty,'unit',ri.unit,'note',ri.note,'optional',ri.optional)
    order by ri.position) from public.cloud_recipe_ingredients ri
    where ri.household_id=h.id and ri.recipe_id=r.id),'[]'::jsonb))
   order by r.updated_at desc,r.id) from public.cloud_recipes r
   where r.household_id=h.id and r.deleted_at is null),'[]'::jsonb)) end
 from current_home c left join public.cloud_households h on h.id=c.id
 left join public.cloud_revisions rv on rv.household_id=h.id
$$;

create function public.cloud_recipe_save(command_id uuid,expected_version bigint,recipe jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare home uuid:=public.cloud_household();actor uuid:=auth.uid();prior public.cloud_recipe_commands;
 request_body jsonb;existing public.cloud_recipes;item jsonb;step jsonb;ingredient_id uuid;
 recipe_id uuid;photo_id uuid;position integer:=0;result_body jsonb;
begin
 if home is null or actor is null then raise exception 'Cloud session required';end if;
 request_body:=jsonb_build_object('expectedVersion',expected_version,'recipe',recipe);
 perform pg_advisory_xact_lock(hashtext(command_id::text));
 select * into prior from public.cloud_recipe_commands c where c.household_id=home and c.user_id=actor and c.command_id=cloud_recipe_save.command_id;
 if found then
  if prior.kind<>'recipe-save' or prior.request<>request_body then raise exception 'Command id reused';end if;
  return prior.result;
 end if;
 if not public.cloud_json_exact(recipe,array['id','title','servings','sourceUrl','sourceText','notes','tags','steps','photoId','ingredients'])
  or jsonb_typeof(recipe->'id')<>'string' or jsonb_typeof(recipe->'title')<>'string'
  or length(trim(recipe->>'title')) not between 1 and 200
  or jsonb_typeof(recipe->'servings')<>'number' or (recipe->>'servings')::numeric not between 0.001 and 1000
  or jsonb_typeof(recipe->'notes')<>'string' or length(recipe->>'notes')>10000
  or not((recipe->'sourceUrl')='null'::jsonb or(jsonb_typeof(recipe->'sourceUrl')='string' and length(recipe->>'sourceUrl')<=4000))
  or not((recipe->'sourceText')='null'::jsonb or(jsonb_typeof(recipe->'sourceText')='string' and length(recipe->>'sourceText')<=100000))
  or jsonb_typeof(recipe->'tags')<>'array' or jsonb_array_length(recipe->'tags')>50
  or jsonb_typeof(recipe->'steps')<>'array' or jsonb_array_length(recipe->'steps')>200
  or jsonb_typeof(recipe->'ingredients')<>'array' or jsonb_array_length(recipe->'ingredients')>200
 then raise exception 'Invalid recipe';end if;
 if exists(select 1 from jsonb_array_elements(recipe->'tags') v where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 80)
 then raise exception 'Invalid tags';end if;
 for step in select value from jsonb_array_elements(recipe->'steps') loop
  if not public.cloud_json_exact(step,array['text','durationSec']) or jsonb_typeof(step->'text')<>'string'
   or length(trim(step->>'text')) not between 1 and 4000
   or not((step->'durationSec')='null'::jsonb or(jsonb_typeof(step->'durationSec')='number'
    and(step->>'durationSec')::numeric between 1 and 86400 and trunc((step->>'durationSec')::numeric)=(step->>'durationSec')::numeric))
  then raise exception 'Invalid step';end if;
 end loop;
 recipe_id:=(recipe->>'id')::uuid;photo_id:=nullif(recipe->>'photoId','')::uuid;
 if photo_id is not null and not exists(select 1 from public.cloud_photos where household_id=home and id=photo_id and state='ready' and deleted_at is null)
 then raise exception 'Photo is not ready';end if;
 select * into existing from public.cloud_recipes where household_id=home and id=recipe_id and deleted_at is null for update;
 if found then
  if expected_version is null or existing.version<>expected_version then raise exception 'Recipe version conflict';end if;
  update public.cloud_recipes set title=trim(recipe->>'title'),servings=(recipe->>'servings')::numeric,
   source_url=nullif(recipe->>'sourceUrl',''),source_text=nullif(recipe->>'sourceText',''),notes=recipe->>'notes',
   tags=array(select v#>>'{}' from jsonb_array_elements(recipe->'tags') v),steps=recipe->'steps',photo_id=cloud_recipe_save.photo_id
   where household_id=home and id=recipe_id;
  delete from public.cloud_recipe_ingredients where household_id=home and recipe_id=cloud_recipe_save.recipe_id;
 elsif expected_version is not null then raise exception 'Recipe version conflict';
 else insert into public.cloud_recipes(household_id,id,title,servings,source_url,source_text,notes,tags,steps,photo_id)
  values(home,recipe_id,trim(recipe->>'title'),(recipe->>'servings')::numeric,nullif(recipe->>'sourceUrl',''),
  nullif(recipe->>'sourceText',''),recipe->>'notes',array(select v#>>'{}' from jsonb_array_elements(recipe->'tags') v),
  recipe->'steps',photo_id);
 end if;
 for item in select value from jsonb_array_elements(recipe->'ingredients') loop
  if not public.cloud_json_exact(item,array['ingredientId','name','category','defaultUnit','isStaple','qty','unit','note','optional'])
   or jsonb_typeof(item->'name')<>'string' or length(trim(item->>'name')) not between 1 and 200
   or not(item->>'category' in('vegetable','meat','seafood','dairy','grain','sauce','other'))
   or jsonb_typeof(item->'defaultUnit')<>'string' or length(item->>'defaultUnit')>80
   or jsonb_typeof(item->'isStaple')<>'boolean'
   or not((item->'qty')='null'::jsonb or(jsonb_typeof(item->'qty')='number' and(item->>'qty')::numeric between 0 and 1000000))
   or jsonb_typeof(item->'unit')<>'string' or length(item->>'unit')>80
   or jsonb_typeof(item->'note')<>'string' or length(item->>'note')>1000
   or jsonb_typeof(item->'optional')<>'boolean'
   or not((item->'ingredientId')='null'::jsonb or jsonb_typeof(item->'ingredientId')='string')
  then raise exception 'Invalid ingredient';end if;
  ingredient_id:=null;
  if(item->'ingredientId')<>'null'::jsonb then
   ingredient_id:=(item->>'ingredientId')::uuid;
   if not exists(select 1 from public.cloud_ingredients where household_id=home and id=ingredient_id and deleted_at is null)
   then raise exception 'Ingredient not found';end if;
  else
   select i.id into ingredient_id from public.cloud_ingredients i where i.household_id=home and i.deleted_at is null and(
    lower(regexp_replace(trim(i.name),'\s+','','g'))=lower(regexp_replace(trim(item->>'name'),'\s+','','g'))
    or exists(select 1 from unnest(i.aliases) a where lower(regexp_replace(trim(a),'\s+','','g'))=lower(regexp_replace(trim(item->>'name'),'\s+','','g'))))
    order by i.id limit 1;
   if ingredient_id is null then
    insert into public.cloud_ingredients(household_id,name,category,default_unit,is_staple)
    values(home,trim(item->>'name'),item->>'category',item->>'defaultUnit',(item->>'isStaple')::boolean) returning id into ingredient_id;
   end if;
  end if;
  insert into public.cloud_recipe_ingredients(household_id,recipe_id,position,ingredient_id,qty,unit,note,optional)
  values(home,recipe_id,position,ingredient_id,nullif(item->>'qty','')::numeric,item->>'unit',item->>'note',(item->>'optional')::boolean);
  position:=position+1;
 end loop;
 select jsonb_build_object('id',id,'version',version) into result_body from public.cloud_recipes where household_id=home and id=recipe_id;
 insert into public.cloud_recipe_commands values(home,actor,command_id,'recipe-save',request_body,result_body,now());
 return result_body;
end $$;

create function public.cloud_recipe_delete(command_id uuid,recipe_id uuid,expected_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare home uuid:=public.cloud_household();actor uuid:=auth.uid();prior public.cloud_recipe_commands;
 request_body jsonb:=jsonb_build_object('recipeId',recipe_id,'expectedVersion',expected_version);current_version bigint;result_body jsonb;
begin
 if home is null or actor is null then raise exception 'Cloud session required';end if;
 perform pg_advisory_xact_lock(hashtext(command_id::text));
 select * into prior from public.cloud_recipe_commands c where c.household_id=home and c.user_id=actor and c.command_id=cloud_recipe_delete.command_id;
 if found then if prior.kind<>'recipe-delete' or prior.request<>request_body then raise exception 'Command id reused';end if;return prior.result;end if;
 select version into current_version from public.cloud_recipes where household_id=home and id=recipe_id and deleted_at is null for update;
 if not found or current_version<>expected_version then raise exception 'Recipe version conflict';end if;
 update public.cloud_recipes set deleted_at=now() where household_id=home and id=recipe_id;
 select jsonb_build_object('id',id,'version',version) into result_body from public.cloud_recipes where household_id=home and id=recipe_id;
 insert into public.cloud_recipe_commands values(home,actor,command_id,'recipe-delete',request_body,result_body,now());
 return result_body;
end $$;

create function public.cloud_photo_begin(command_id uuid,metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare home uuid:=public.cloud_household();actor uuid:=auth.uid();prior public.cloud_recipe_commands;
 proposed_id uuid;photo public.cloud_photos;result_body jsonb;
begin
 if home is null or actor is null then raise exception 'Cloud session required';end if;
 perform pg_advisory_xact_lock(hashtext(command_id::text));
 select * into prior from public.cloud_recipe_commands c where c.household_id=home and c.user_id=actor and c.command_id=cloud_photo_begin.command_id;
 if found then if prior.kind<>'photo-begin' or prior.request<>metadata then raise exception 'Command id reused';end if;return prior.result;end if;
 if not public.cloud_json_exact(metadata,array['id','sha256','mimeType','byteSize']) or jsonb_typeof(metadata->'id')<>'string'
  or(metadata->>'sha256')!~'^[a-f0-9]{64}$' or not(metadata->>'mimeType' in('image/jpeg','image/png','image/webp'))
  or jsonb_typeof(metadata->'byteSize')<>'number' or(metadata->>'byteSize')::integer not between 1 and 5242880
 then raise exception 'Invalid photo';end if;
 proposed_id:=(metadata->>'id')::uuid;
 select * into photo from public.cloud_photos p where p.household_id=home and p.deleted_at is null and p.state='ready'
  and p.sha256=metadata->>'sha256' and p.mime_type=metadata->>'mimeType' and p.byte_size=(metadata->>'byteSize')::integer order by p.id limit 1;
 if found then result_body:=jsonb_build_object('id',photo.id,'objectPath',photo.object_path,'uploadRequired',false);
 else
  insert into public.cloud_photos(household_id,id,object_path,sha256,mime_type,byte_size)
  values(home,proposed_id,home::text||'/'||proposed_id::text,metadata->>'sha256',metadata->>'mimeType',(metadata->>'byteSize')::integer) returning * into photo;
  result_body:=jsonb_build_object('id',photo.id,'objectPath',photo.object_path,'uploadRequired',true);
 end if;
 insert into public.cloud_recipe_commands values(home,actor,command_id,'photo-begin',metadata,result_body,now());
 return result_body;
end $$;

create function public.cloud_photo_finalize(command_id uuid,photo_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare home uuid:=public.cloud_household();actor uuid:=auth.uid();prior public.cloud_recipe_commands;
 request_body jsonb:=jsonb_build_object('photoId',photo_id);photo public.cloud_photos;object_metadata jsonb;result_body jsonb;
begin
 if home is null or actor is null then raise exception 'Cloud session required';end if;
 perform pg_advisory_xact_lock(hashtext(command_id::text));
 select * into prior from public.cloud_recipe_commands c where c.household_id=home and c.user_id=actor and c.command_id=cloud_photo_finalize.command_id;
 if found then if prior.kind<>'photo-finalize' or prior.request<>request_body then raise exception 'Command id reused';end if;return prior.result;end if;
 select * into photo from public.cloud_photos where household_id=home and id=photo_id and deleted_at is null for update;
 if not found then raise exception 'Photo not found';end if;
 if photo.state='pending' then
  select metadata into object_metadata from storage.objects where bucket_id='cloud-photos' and name=photo.object_path;
  if not found or coalesce((object_metadata->>'size')::integer,-1)<>photo.byte_size or coalesce(object_metadata->>'mimetype','')<>photo.mime_type
  then raise exception 'Uploaded photo does not match';end if;
  update public.cloud_photos set state='ready' where household_id=home and id=photo_id;
 end if;
 select jsonb_build_object('id',id,'version',version,'objectPath',object_path) into result_body from public.cloud_photos where household_id=home and id=photo_id;
 insert into public.cloud_recipe_commands values(home,actor,command_id,'photo-finalize',request_body,result_body,now());
 return result_body;
end $$;

create function public.cloud_photo_abort(command_id uuid,photo_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare home uuid:=public.cloud_household();actor uuid:=auth.uid();prior public.cloud_recipe_commands;
 request_body jsonb:=jsonb_build_object('photoId',photo_id);result_body jsonb;
begin
 if home is null or actor is null then raise exception 'Cloud session required';end if;
 perform pg_advisory_xact_lock(hashtext(command_id::text));
 select * into prior from public.cloud_recipe_commands c where c.household_id=home and c.user_id=actor and c.command_id=cloud_photo_abort.command_id;
 if found then if prior.kind<>'photo-abort' or prior.request<>request_body then raise exception 'Command id reused';end if;return prior.result;end if;
 if exists(select 1 from storage.objects o join public.cloud_photos p on p.object_path=o.name
  where p.household_id=home and p.id=photo_id and o.bucket_id='cloud-photos') then raise exception 'Remove object first';end if;
 update public.cloud_photos set deleted_at=now() where household_id=home and id=photo_id and state='pending' and deleted_at is null;
 if not found then raise exception 'Pending photo not found';end if;
 result_body:=jsonb_build_object('id',photo_id,'aborted',true);
 insert into public.cloud_recipe_commands values(home,actor,command_id,'photo-abort',request_body,result_body,now());
 return result_body;
end $$;

revoke all on function public.cloud_recipe_snapshot(),public.cloud_recipe_save(uuid,bigint,jsonb),
 public.cloud_recipe_delete(uuid,uuid,bigint),public.cloud_photo_begin(uuid,jsonb),
 public.cloud_photo_finalize(uuid,uuid),public.cloud_photo_abort(uuid,uuid) from public,anon;
grant execute on function public.cloud_recipe_snapshot(),public.cloud_recipe_save(uuid,bigint,jsonb),
 public.cloud_recipe_delete(uuid,uuid,bigint),public.cloud_photo_begin(uuid,jsonb),
 public.cloud_photo_finalize(uuid,uuid),public.cloud_photo_abort(uuid,uuid) to authenticated,service_role;

grant insert,delete on storage.objects to authenticated;
create policy cloud_photo_upload on storage.objects for insert to authenticated with check(
 bucket_id='cloud-photos' and exists(select 1 from public.cloud_photos p where p.object_path=name
 and p.household_id=(select public.cloud_household()) and p.state='pending' and p.deleted_at is null));
create policy cloud_photo_abort_object on storage.objects for delete to authenticated using(
 bucket_id='cloud-photos' and exists(select 1 from public.cloud_photos p where p.object_path=name
 and p.household_id=(select public.cloud_household()) and p.state='pending' and p.deleted_at is null));
