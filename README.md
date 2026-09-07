---
sync_version: 1
content_hash: faba8898d50fee8b8aa33ce868c331d9a6684dd170dff504c21e9c450403763d
---

# homecook

> **Language**: **English** · [한국어](README_ko.md)
> **Status**: 🚧 M1 in progress
> A personal home-cooking app — recipes, pantry, meal plan and a kitchen-friendly cook mode, running offline on your phone.

## What this is

homecook is a single-user, offline-first PWA for cooking at home. No account, no
server, no sharing — the phone is propped on the counter and everything it needs is
already on the device.

Four milestones, built as one loop rather than four features:

```
Pantry ──▶ What should I cook? ──▶ Cook mode ──▶ Cook log
   ▲                                               │
   └──── Shopping list ◀── Meal plan ◀─────────────┘
```

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M1** | Recipe archive, paste-to-parse import, cook log, backup | 🚧 In progress — import and backup done; cook log next |
| **M2** | Cook mode — full-screen steps, timers, Wake Lock | Planned |
| **M3** | Pantry inventory and "what can I cook now" suggestions | Planned |
| **M4** | Weekly meal plan → shopping list | Planned |

Start with [`docs/product-brief.md`](docs/product-brief.md) for the problem and scope,
[`docs/data-model.md`](docs/data-model.md) for the schema, and
[`docs/design.md`](docs/design.md) for the design system.

Key decisions are recorded as ADRs:
[local-first, no backend](docs/adr/0001-local-first-no-backend.md) ·
[normalized ingredients from M1](docs/adr/0002-normalized-ingredients-from-m1.md).

### Running the app

```bash
cd app
bun install
bun run dev      # dev server
bun run test     # unit tests
bun run build    # production PWA build
```

### Deployment

Deployed on Vercel. The app is not at the repository root, so the Vercel project
must have:

| Setting | Value |
|---------|-------|
| **Root Directory** | `app` |

Everything else comes from [`app/vercel.json`](app/vercel.json): it serves `dist`,
rewrites unmatched paths to `index.html` (required — the router uses real URLs, so
`/recipes/<id>` would 404 on refresh without it), and keeps `sw.js` uncached so a
new version is picked up.

Config lives in `app/`, not the repository root, because Vercel runs the build
*inside* the Root Directory: a root-level config with `cd app` in its build command
fails with `cd: app: No such file or directory`.

**`app/` must be self-contained.** The deployment only ever sees that directory, so
every dependency it compiles against has to be in `app/package.json` — including
type packages. A local build can pass while the deployment fails, because
TypeScript walks up to the parent `node_modules` that exists in a full checkout and
does not exist on Vercel. To reproduce a deployment build honestly, copy `app/`
somewhere with no parent `node_modules` and run `bun install && bun run build`
there.

**Data does not follow the app between origins.** IndexedDB is scoped to
scheme + host + port, so recipes entered against `localhost` do not appear on the
deployed URL, and vice versa. Move data with a backup export/restore from
Settings.

## Overview

The rest of this README documents the `co-develop` agent team this project was
scaffolded from — the PM, Architect, Designer, Code Writer, Test Runner, Security
Monitor and Stack Setup specialists that build the app. See docs/context.md for full
architecture and standards.

## Quick Start

This is a stable variant of the workspace template. It inherits from `templates/common` and includes variant-specific customizations.

### For Claude Code users:

See `CLAUDE.md` for detailed instructions.

### For Gemini CLI users:

See `GEMINI.md` for detailed instructions.

## Team Mission

**Mission:** Software development workflow — full agent team with PM, Architect, Designer, Code Writer, Test Runner, Security Monitor, and Stack Setup Specialist (tech stack detection and environment initialization)

## Meet the AI Team

Your partners consist of specialized agents, each with a distinct role. The **Project Manager (PM)** is your single point of entry—they orchestrate the rest of the team.

| Agent | Role | Tier | Model |
|-------|------|------|-------|
| **PM** | Project Manager — workflow orchestration, dispatch, quality gates | high | inherit |
| **architect** | Design agent - produces implementation plans and technical specs | high | inherit |
| **code-writer** | Implementation agent - writes code from an approved plan | low | inherit |
| **designer** | UI/UX design agent - produces wireframes, component specs, and design tokens | medium | inherit |
| **security-monitor** | Security monitor - scans for vulnerabilities, advisories, and secret leaks | medium | inherit |
| **stack-setup** | Stack Setup Specialist | low | inherit |
| **test-runner** | QA and verification agent - runs tests and validates acceptance criteria | medium | inherit |

## Skills

- **code-review**: Conducts thorough code reviews focusing on correctness, maintainability, security, and best practices. Use when: reviewing pull requests, evaluating code quality, providing constructive feedback, or ensuring code standards compliance.
- **refactoring**: Improves code structure and design while preserving behavior using systematic refactoring techniques. Use when: cleaning up code, reducing duplication, improving maintainability, or paying down technical debt.
- **swe-solve**: Autonomous 4-stage issue-to-PR resolution pipeline for software engineering tasks, featuring test-driven validation and pull-request synthesis.
- **test-driven-development**: Implements software using Test-Driven Development (TDD) methodology with red-green-refactor cycle. Use when: developing new features, fixing bugs with tests, or ensuring code reliability through test-first approach.

## How to Collaborate

Working with us is structured to maximize quality and prevent collisions. Here is our standard workflow:

### A. The PM Gateway

Always start your requests by talking to the **PM**. Do not invoke specialist agents directly. The PM will analyze your request and bring in the right experts.

### B. Standard Workflow Phases

1. **Team Assembly:** The PM creates specialized agents/skills if required.
2. **Triage:** The PM classifies the request; dispatches read-only agents in parallel.
3. **Analysis:** The PM synthesizes findings into requirements + acceptance criteria.
4. **Design:** An architect produces an implementation plan + ADR.
5. **Implementation:** Specialists implement; the PM loops up to 3× on failures.
6. **Finalization:** The PM logs decisions; runs `/sync`; opens a PR.

### C. Available Commands

Our daily operations are driven by slash commands (registered as Skills by Claude Code and Gemini CLI):

- `/sync "feat: ..."` — Full pipeline: memlog → changelog → audit → commit → PR.
- `/changelog "..."` — Add an entry to `CHANGELOG.md`.
- `/memlog "summary"` — Append a summary to today's session log.
- `/meeting` — Run a structured, inline multi-agent discussion.

## Variant Type

**Type**: development

This variant focuses on software development workflows, feature implementation, and integration testing.

---

*Last Updated: 2026-09-07*
