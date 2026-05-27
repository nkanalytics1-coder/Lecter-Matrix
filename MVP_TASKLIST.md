# MVP Task List

Ordered, single-session tasks. Each touches a disjoint file set (no two tasks write
the same file → near-zero merge conflicts). One task per branch/PR. Tests ship with
the task. Build top to bottom; tasks in the same wave with no shared files run in
parallel. `[x]` when merged with CI green + acceptance met.

Legend: **Files** = exclusive write surface · **AC** = acceptance criteria · **Tests** = required.

## Wave 1 — Bootstrap
- [ ] **T1 Scaffold.** Files: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `components.json`, `.eslintrc.cjs`, `.prettierrc`. AC: `tsc --noEmit` clean under strict flags; `next build` exits 0; a shadcn button renders. Tests: build is the check.
- [ ] **T2 CI + env.** Files: `.github/workflows/ci.yml`, `src/env.ts`, `vitest.config.ts`, `playwright.config.ts`. AC: CI runs typecheck/lint/test/build; missing required env fails fast. Tests: `env.ts` valid + missing-var cases.

## Wave 2 — Contracts (parallel; no shared files)
- [ ] **T3 Domain + entities.** Files: `src/contracts/types/domain.ts`, `src/contracts/types/entities.ts`. AC: all enums + DTOs compile; enum values match DB CHECKs exactly. 
- [ ] **T4 API types.** Files: `src/contracts/types/api.ts`. AC: `ApiResult`, `ApiError`, code→status map, `Paginated`, cursor types compile.
- [ ] **T5 Zod schemas.** Files: `src/contracts/schemas/requests.ts`. Deps: T3,T4. AC: CSV-enum filter parse works; invalid enum + window-order rejected; input types are `z.infer`. Tests: parse/reject suite.
- [ ] **T6 Contract utils.** Files: `src/contracts/lib/contract-utils.ts`, `test/contracts/contract-utils.test.ts`. Deps: T3,T4. AC: `ok/fail`, cursor encode/decode roundtrip (+garbage→null), `requireRole`, `backoffMs` monotonic+capped. Tests: all of the above.
- [ ] **T7 UI contracts.** Files: `src/contracts/ui/props.ts`, `src/contracts/ui/columns.ts`. Deps: T3,T5. AC: column defs + component props compile against the DTOs.

## Wave 3 — Database
- [ ] **T8 Migrations 0001–0003.** Files: `supabase/migrations/0001_extensions.sql`, `0002_tenancy.sql`, `0003_fact.sql`. AC: apply on clean PG; `gsc_metric` PK rejects dup; two indexes present.
- [ ] **T9 Migrations 0004–0005.** Files: `supabase/migrations/0004_results.sql`, `0005_rls.sql`. Deps: T8. AC: results + triage + run tables apply; RLS denies cross-account select on `project`/`cannibalization_group`.
- [ ] **T10 Seed + smoke.** Files: `supabase/seed.sql`, `test/db/migrations.test.ts`. Deps: T9. AC: ephemeral PG applies 0001–0005 + seed; RLS isolation + idempotent re-sync assertions pass.

## Wave 4 — Server core
- [ ] **T11 DB clients.** Files: `server/db/clients.ts`, `server/db/types.ts`. Deps: T2,T3. AC: `anonClient(req)` (RLS) + `serviceClient()` (`server-only`); generated types match schema; service client not in client bundle.
- [ ] **T12 Auth + middleware.** Files: `server/auth.ts`, `middleware.ts`. Deps: T11,T6. AC: unauth → 401 on guarded routes; `/api/cron/*` bypasses; role resolved from `app_user`.
- [ ] **T13 withHandler + log.** Files: `server/http.ts`, `server/log.ts`, `test/server/http.test.ts`. Deps: T6,T12. AC: ZodError→`validation_error` 400 w/ fieldErrors; ContractError→mapped; success→envelope; every response has `requestId`; structured JSON logs, no secrets. Tests: each error class.

## Wave 5 — Ingestion
- [ ] **T14 Normalize/classify.** Files: `server/ingest/normalize.ts`, `test/ingest/normalize.test.ts`. Deps: T3. AC: `normalizeQuery`/`classifyPage`/`slugTokens`/`isPersonalized`/`detectIntent` pure + deterministic; Eurofides cases pass. Tests: table-driven.
- [ ] **T15 GSC client.** Files: `server/ingest/gsc-client.ts`, `test/ingest/gsc-client.test.ts`. Deps: T6. AC: OAuth refresh; per-date pagination stops at `<rowLimit`; 429/5xx backoff; 401/403→`gsc_auth_error`. Tests: mocked pagination + retry.
- [ ] **T16 Persist.** Files: `server/ingest/persist.ts`, `test/ingest/persist.test.ts`. Deps: T14,T11,T8. AC: `COPY`→staging→`ON CONFLICT` merge; one tx/date; re-running a date is idempotent (counts stable, values overwritten).

## Wave 6 — Engine
- [ ] **T17 Scoring + action table.** Files: `server/engine/scoring.ts`, `server/engine/action-table.ts`, `test/engine/scoring.test.ts`, `test/engine/action-table.test.ts`. Deps: T14. AC: winner=max clicks; severity∈[0,100] (V/S/P weights); dominance shares + inversion; benign rules (base_variant/mother_child); all 8 action branches mapped; `consolidate_301` only when slugJaccard≥0.5 ∧ ¬variant. Tests: per branch + boundary.
- [ ] **T18 Detect orchestrator.** Files: `server/engine/detect.ts`, `test/engine/golden.test.ts`. Deps: T16,T17,T9. AC: one SQL pass (impression-weighted position) → candidates; `group_key` stable across runs; upsert + prune-not-seen; run recorded. Golden snapshot on Eurofides fixture (groups+severity+actions+thresholds) frozen.

## Wave 7 — Cron + ingest/detect routes
- [ ] **T19 Cron tick + manual routes.** Files: `server/cron/tick.ts`, `app/api/cron/tick/route.ts`, `app/api/projects/[id]/sync/route.ts`, `app/api/projects/[id]/detect/route.ts`, `test/cron/tick.test.ts`. Deps: T15,T16,T18,T13. AC: tick (cron-secret) iterates active projects → sync inline → detect inline; chunk+resume via `last_synced_date`; manual sync/detect idempotent + tenant-scoped.

## Wave 8 — Repositories + API
- [ ] **T20 Repos.** Files: `server/repositories/project.repo.ts`, `server/repositories/group.repo.ts`, `server/repositories/misc.repo.ts`, `test/repositories/group.repo.test.ts`. Deps: T13,T3. AC: keyset group list w/ correct `nextCursor` (no OFFSET); drill via single `json_agg`; mappers produce exact DTOs; RLS respected via anon client.
- [ ] **T21 Project + GSC routes.** Files: `app/api/me/route.ts`, `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`, `app/api/projects/[id]/gsc/auth-url/route.ts`, `app/api/projects/[id]/gsc/connect/route.ts`, `app/api/projects/[id]/gsc/disconnect/route.ts`. Deps: T20,T15. AC: project CRUD (409 on dup); connect stores encrypted token + triggers backfill; all via `withHandler`.
- [ ] **T22 Group + overview + export routes.** Files: `app/api/projects/[id]/groups/route.ts`, `app/api/projects/[id]/overview/route.ts`, `app/api/projects/[id]/export/route.ts`, `app/api/groups/[groupId]/route.ts`, `app/api/groups/[groupId]/state/route.ts`, `test/api/export.test.ts`. Deps: T20. AC: list honors all filters/sort/cursor; drill returns members; state upserts by group_key + emits event; export streams filtered CSV; overview from on-read aggregation.

## Wave 9 — Frontend shell + data
- [ ] **T23 Shell + data layer.** Files: `app/(app)/layout.tsx`, `components/shell/TopBar.tsx`, `components/shell/LeftNav.tsx`, `components/shell/ThemeToggle.tsx`, `lib/api-client.ts`, `lib/query-client.tsx`, `lib/search-params.ts`. Deps: T4,T5,T1. AC: typed `apiClient` returns `ApiResult`; TanStack Query configured; nuqs parsers for filter/sort/cursor; dark/light tokens.
- [ ] **T24 Project context + switcher + sync pill.** Files: `app/(app)/p/[projectId]/layout.tsx`, `components/shell/ProjectSwitcher.tsx`, `components/shell/SyncStatusPill.tsx`, `app/(app)/page.tsx`. Deps: T23,T21. AC: switching project updates URL+context; sync pill reflects connection status; project list lands.

## Wave 10 — Exploration UI
- [ ] **T25 DataTable + cells.** Files: `components/grid/DataTable.tsx`, `components/grid/Cell.tsx`, `components/cells/SeverityBadge.tsx`, `components/cells/MetricCell.tsx`, `components/cells/InversionFlag.tsx`, `components/cells/CannTypeTag.tsx`, `components/cells/StatusPill.tsx`, `components/cells/ActionTag.tsx`, `test/components/DataTable.test.tsx`. Deps: T7,T23. AC: generic over `Row`; server-driven sort writes URL (no client sort); keyset "Load more" (no virtualization); pinned query col; `—` for null; severity = color+number; `role=grid`/`aria-sort`; keyboard nav.
- [ ] **T26 FilterBar + presets.** Files: `components/filters/FilterBar.tsx`, `components/filters/PresetChips.tsx`, `components/filters/FacetSelect.tsx`, `components/filters/RangeInput.tsx`. Deps: T7,T23. AC: filters live to URL; presets (*Critical inversions*, *Quick wins*, *Unresolved*, *Hide benign*) apply full filter; clear-all resets.
- [ ] **T27 Groups page.** Files: `app/(app)/p/[projectId]/groups/page.tsx`, `components/groups/GroupTable.tsx`, `components/grid/columns.groups.tsx`. Deps: T25,T26,T22. AC: RSC fetches first keyset page → hydrates client table; filter/sort/paginate via query; column order per API_SPEC.
- [ ] **T28 Drill route.** Files: `app/(app)/p/[projectId]/groups/[groupId]/page.tsx`, `components/groups/GroupDetail.tsx`, `components/groups/MemberCompare.tsx`, `components/groups/ActionPanel.tsx`, `components/groups/TriagePanel.tsx`. Deps: T27,T22. AC: plain route; inversion banner prominent; member table; action copy templated from enum+metadata; triage optimistic + persists.

## Wave 11 — Secondary + states + ship
- [ ] **T29 Overview + settings.** Files: `app/(app)/p/[projectId]/overview/page.tsx`, `components/overview/Overview.tsx`, `components/overview/SeverityDistribution.tsx`, `app/(app)/p/[projectId]/settings/page.tsx`, `components/settings/SettingsForm.tsx`. Deps: T22,T25. AC: severity distribution bar (click-through to filtered groups); settings edits `project.config` (validated) + GSC reconnect.
- [ ] **T30 Onboarding + login + states.** Files: `app/(auth)/login/page.tsx`, `app/(auth)/onboarding/page.tsx`, `components/onboarding/Wizard.tsx`, `components/states/EmptyState.tsx`, `components/states/ErrorBand.tsx`, plus `loading.tsx`/`error.tsx` per route. Deps: T23,T21,T27,T28. AC: onboarding completes OAuth → backfill enqueued; every route has loading/error/empty per CLAUDE rules (em-dash nulls, distinct empties, last-good-on-error).
- [ ] **T31 Deploy + E2E.** Files: `vercel.json`, `docs/DEPLOY.md`, `e2e/smoke.spec.ts`. Deps: T19,T28,T30. AC: Vercel cron (`0 6 * * *` → `/api/cron/tick`) + env mapped; Node runtime for service routes; Playwright smoke: onboard→(mock GSC)→sync→detect→see groups→triage→export. Tag `v0.1.0`.

## Definition of done (every task)
`tsc --noEmit` clean · listed tests pass · only the task's files changed · ≤~400 LOC ·
conventional commit · CI green. Demoable after T18; shippable after T30.
