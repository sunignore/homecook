// Whether this build was given shared-server credentials. It lives in its own
// module so a screen can ask the question without importing ./client, which
// pulls @supabase/supabase-js into whatever bundle reaches it. The cooking path
// must stay as light as it was before household mode existed (design.md E6).

export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);
