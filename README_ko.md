---
sync_version: 1
translated_from_hash: afcdf11dade9d1d3dff74aad7d02a606dd729a5aaa5b6fc46007dd9e343f6182
lang: ko
lang_reason: source-material
---

# homecook

> **언어**: [English](README.md) · **한국어**
> **상태**: M1–M4 구현 완료 · 실제 사용 검증 진행 중
> 나 혼자 쓰는 홈쿠킹 앱 — 레시피, 냉장고, 식단, 그리고 주방에서 쓰기 좋은 조리 모드. 오프라인으로 동작합니다.

## 이게 뭔가요

homecook은 1인용 오프라인 우선 PWA입니다. 계정도, 서버도, 공유도 없습니다 — 폰을
조리대에 세워두면 필요한 것은 전부 기기 안에 있습니다.

4개의 마일스톤은 별개 기능이 아니라 하나의 순환 루프입니다:

```
냉장고 ──▶ 오늘 뭐 먹지 ──▶ 조리 모드 ──▶ 요리 기록
   ▲                                        │
   └──── 장보기 리스트 ◀── 주간 식단 ◀──────┘
```

| 마일스톤 | 범위 | 상태 |
|---------|------|------|
| **M1** | 레시피 아카이브, 붙여넣기 가져오기, 요리 기록, 백업 | 구현 완료 · 사용 목표 검증 전 |
| **M2** | 조리 모드 — 풀스크린 단계, 타이머, 화면 꺼짐 방지 | 구현 완료 · 실제 조리 검증 전 |
| **M3** | 냉장고 재고와 "지금 만들 수 있는 요리" 추천 | 구현 완료 · 저녁 메뉴 결정 검증 전 |
| **M4** | 주간 식단 → 장보기 리스트 | 구현 완료 · 매장 사용 검증 전 |

구현 상태와 제품 검증 상태는 별도로 관리합니다. 코드가 완성됐더라도
[`docs/product-brief.md`](docs/product-brief.md)의 실제 사용 기준을 충족해야 해당 마일스톤이
검증된 것으로 봅니다.

문제 정의와 범위는 [`docs/product-brief.md`](docs/product-brief.md), 스키마는
[`docs/data-model.md`](docs/data-model.md), 디자인 시스템은
[`docs/design.md`](docs/design.md)를 보세요.

주요 결정은 ADR로 기록되어 있습니다:
[로컬 우선, 백엔드 없음](docs/adr/0001-local-first-no-backend.md) ·
[M1부터 재료 정규화](docs/adr/0002-normalized-ingredients-from-m1.md).

### 앱 실행

```bash
cd app
bun install
bun run dev      # 개발 서버
bun run test     # 단위 테스트
bun run build    # 프로덕션 PWA 빌드
```

### 배포

Vercel에 배포합니다. 앱이 레포 루트가 아니므로 Vercel 프로젝트에 다음 설정이 필요합니다.

| 설정 | 값 |
|------|-----|
| **Root Directory** | `app` |

나머지는 [`app/vercel.json`](app/vercel.json)이 처리합니다. `dist`를 서빙하고, 매칭되지 않는
경로를 `index.html`로 rewrite하며(라우터가 실제 URL을 쓰므로 이게 없으면 `/recipes/<id>`에서
새로고침 시 404됩니다), `sw.js`는 캐시하지 않아 새 버전이 바로 적용됩니다.

설정 파일이 레포 루트가 아니라 `app/`에 있는 이유는, Vercel이 빌드를 Root Directory **안에서**
실행하기 때문입니다. 루트에 두고 빌드 명령에 `cd app`을 쓰면
`cd: app: No such file or directory`로 실패합니다.

**`app/`은 자기완결적이어야 합니다.** 배포 환경은 이 디렉터리만 보므로, 컴파일에 필요한 모든
의존성이 `app/package.json`에 있어야 합니다 — 타입 패키지 포함입니다. 로컬 빌드는 통과하는데
배포만 실패할 수 있는데, TypeScript가 상위 `node_modules`까지 올라가 타입을 찾기 때문입니다.
그 상위 디렉터리는 전체 체크아웃에는 있고 Vercel에는 없습니다. 배포 빌드를 정직하게
재현하려면 `app/`을 상위 `node_modules`가 없는 곳에 복사한 뒤
`bun install && bun run build`를 실행하세요.

**데이터는 오리진을 따라가지 않습니다.** IndexedDB는 스킴+호스트+포트 단위로 격리되므로,
`localhost`에서 넣은 레시피는 배포된 주소에 나타나지 않으며 반대도 마찬가지입니다.
설정 화면의 백업 내보내기/복원으로 옮기세요.

## 개요 (에이전트 팀)

아래는 이 프로젝트를 스캐폴딩한 `co-develop` 에이전트 팀 문서입니다 — 앱을 만드는
PM, Architect, Designer, Code Writer, Test Runner, Security Monitor, Stack Setup
전문가들입니다.


## 빠른 시작

이것은 워크스페이스 템플릿의 안정적인 변형입니다. `templates/common`에서 상속하며 변형별 맞춤 설정을 포함합니다.

### Claude Code 사용자:

자세한 지침은 `CLAUDE.md`를 참고하세요.

### Gemini CLI 사용자:

자세한 지침은 `GEMINI.md`를 참고하세요.

## 팀 미션

**미션:** Software development workflow — full agent team with PM, Architect, Designer, Code Writer, Test Runner, Security Monitor, and Stack Setup Specialist (tech stack detection and environment initialization)

## AI 팀 소개

당신의 파트너는 각기 고유한 역할을 가진 전문 에이전트들입니다. **프로젝트 매니저(PM)**가 유일한 진입점이며 나머지 팀을 조율합니다.

| 에이전트 | 역할 | 티어 | 모델 |
|---------|------|------|------|
| **PM** | Project Manager — workflow orchestration, dispatch, quality gates | high | inherit |
| **architect** | Design agent - produces implementation plans and technical specs | high | inherit |
| **code-writer** | Implementation agent - writes code from an approved plan | low | inherit |
| **designer** | UI/UX design agent - produces wireframes, component specs, and design tokens | medium | inherit |
| **security-monitor** | Security monitor - scans for vulnerabilities, advisories, and secret leaks | medium | inherit |
| **stack-setup** | Stack Setup Specialist | low | inherit |
| **test-runner** | QA and verification agent - runs tests and validates acceptance criteria | medium | inherit |

## 스킬

- **code-review**: Conducts thorough code reviews focusing on correctness, maintainability, security, and best practices. Use when: reviewing pull requests, evaluating code quality, providing constructive feedback, or ensuring code standards compliance.
- **refactoring**: Improves code structure and design while preserving behavior using systematic refactoring techniques. Use when: cleaning up code, reducing duplication, improving maintainability, or paying down technical debt.
- **swe-solve**: Autonomous 4-stage issue-to-PR resolution pipeline for software engineering tasks, featuring test-driven validation and pull-request synthesis.
- **test-driven-development**: Implements software using Test-Driven Development (TDD) methodology with red-green-refactor cycle. Use when: developing new features, fixing bugs with tests, or ensuring code reliability through test-first approach.

## 협업 방법

협업 방식은 품질을 극대화하고 충돌을 방지하도록 구조화되어 있습니다. 표준 워크플로는 다음과 같습니다:

### A. PM 게이트웨이

항상 요청을 시작할 때 **PM**과 먼저 대화하세요. 전문 에이전트를 직접 호출하지 마세요. PM이 요청을 분석하고 적절한 전문가를 불러옵니다.

### B. 표준 워크플로 단계

1. **팀 구성:** PM이 필요한 전문 에이전트/스킬을 생성합니다.
2. **분류:** PM이 요청을 분류하고 읽기 전용 에이전트를 병렬로 배치합니다.
3. **분석:** PM이 조사 결과를 요구사항 + 완료 기준으로 종합합니다.
4. **설계:** 아키텍트가 구현 계획 + ADR을 작성합니다.
5. **구현:** 전문가가 구현하고, PM은 실패 시 최대 3회까지 반복합니다.
6. **마무리:** PM이 결정을 기록하고 `/sync`를 실행한 뒤 PR을 엽니다.

### C. 사용 가능한 명령어

일상적인 작업은 슬래시 명령어(Claude Code 및 Gemini CLI에서 Skill로 등록됨)로 구동됩니다:

- `/sync "feat: ..."` — 전체 파이프라인: memlog → changelog → audit → commit → PR.
- `/changelog "..."` — `CHANGELOG.md`에 항목 추가.
- `/memlog "summary"` — 오늘 세션 로그에 요약 추가.
- `/meeting` — 구조화된 인라인 다중 에이전트 토론 진행.

## 변형 유형

**유형**: development

이 변형은 소프트웨어 개발 워크플로, 기능 구현, 통합 테스트에 중점을 둡니다.

---

*최근 업데이트: 2026-09-08*
