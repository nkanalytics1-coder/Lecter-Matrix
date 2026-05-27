# CLAUDE.md

Permanent context for Claude Code. Read before any task. Rules are binding; if a
request conflicts with a rule, follow the rule and say so. `SSOT.md` is the full
spec; the other root docs (`SYSTEM_ARCHITECTURE`, `DATABASE_SCHEMA`, `API_SPEC`,
`MVP_TASKLIST`, `PROJECT_ROADMAP`) expand specific areas. Specs beat assumptions.

## Project
Vertical app that detects keyword cannibalization from Google Search Console (GSC)
data. Unit: `(query, page)` over a date window, per project. Output: ranked
cannibalization groups with severity, winner URL, should-win URL (**inversion
flag**), benign flag, and a deterministic recommended action. **Not** an SEO suite.

## Architecture (fixed)
- Next.js App Router + TS · Supabase Postgres · Vercel (cron, no queue).
- **One fact table** `gsc_metric` (no partitioning, no aggregates, no matviews).
- Results in `cannibalization_group/_member`; triage in `group_state` (run-stable `group_key`).
- Detection = **one SQL pass + pure TS scoring + action decision table.** Deterministic. No LLM, no embeddings, no network in the detection path.
- Sync + detect run **inline** in a cron handler. No job queue.
- Frontend **paginates** (keyset, 50/page); does **not** virtualize. Drill = plain route.
- `src/contracts` is the single source of truth for types; request types are `z.infer` of zod schemas.
- **Internal single-operator tool: no accounts, no roles, no RLS, no tenant column.** Auth = one signed-in Supabase user gate. (Multi-tenant is a future addition; see PROJECT_ROADMAP.)

## Folders
```
app/(auth|app)/…           routes; api/* = thin handlers (parse→repo→ApiResult)
server/                    'server-only': db, auth, http, ingest, engine, repositories, cron
  engine/{detect,scoring,action-table}.ts   the entire engine
src/contracts/{types,schemas,lib,ui}        client+server-safe types/zod/utils
components/{shell,grid,filters,groups,cells,states}   client UI
lib/{api-client,query-client,search-params}.ts        client data layer
supabase/migrations/NNNN_*.sql              append-only
test/**                                      mirrors source
```
Service-role DB code lives in `server/` and starts with `import 'server-only'`.
`src/contracts` imports nothing Node-only or DB-bound. No logic in route handlers or components.

## TypeScript
`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`. No `any` (use `unknown`+narrow),
no `!` except after a guard, no `as` to silence. Omit optional fields (never set
`undefined`). Explicit signatures on public functions. Exhaustive enum switches end in `assertNever`.

## Naming
Logic files kebab-case · components PascalCase · repos `<entity>.repo.ts` ·
DTOs `…DTO` · zod `…Schema` · enums const-tuple + `(typeof X)[number]` ·
DB tables/columns singular snake_case · indexes `ix_…`, constraints `fk_/uq_/ck_…` ·
migrations `NNNN_name.sql`. DTOs camelCase; DB snake_case; map only in repos.

## Database rules
- One `serviceClient()` (`server/` only) does all DB work; an anon SSR client exists only to read the session in middleware. Never bundle the service key client-side.
- No RLS, no tenant column: this is a single-operator tool. Authorization is one gate — a signed-in session (`requireSession`). Add RLS only if it ever goes multi-customer (ROADMAP).
- **No ORM.** Raw parameterized SQL in repositories only. No SQL in handlers/components.
- Migrations append-only; never edit a merged one. Forward-fix in prod.
- `gsc_metric` (and every table) is server-only — the client never reads it directly, only via API handlers.

## SQL standards
- Always parameterized; filters compile to `{sql, params}` (pure fn).
- **Keyset pagination only — `OFFSET` forbidden** on large sets.
- **Impression-weighted position everywhere**: `sum(position*impressions)/nullif(sum(impressions),0)`. Plain `avg(position)` is a bug.
- Set-based merges (`COPY`→unlogged staging→`INSERT … ON CONFLICT`); no row-by-row over large data.
- `gsc_metric` has exactly two indexes. A new access pattern → an aggregate table (per ROADMAP triggers), not a new fact index.

## API conventions
- Every endpoint returns `ApiResult<T>` (`{data,error}`); errors use the fixed code→status map + `requestId`.
- Every handler goes through `withHandler`: parse(zod)→require session→run→envelope. ≤30 lines. No roles/ownership checks (single operator).
- Filters: flat URL params, CSV-enum multi-value, explicit `*Min` (no operators in values). Sort: `?sort=field:dir`, whitelisted. Pagination: keyset cursor (`buildPage`).
- Mutations doing work are idempotent. DTOs never include secrets.
- Node.js runtime for handlers using service role or `COPY`.

## Error handling & logging
- Throw `ContractError(code,message)` for expected failures; `withHandler` maps it. Unknown → `internal_error` 500, logged with `requestId`, never leaked.
- GSC: `401/403`→connection `revoked/error`+`gsc_auth_error`; `429/5xx`→backoff; per-group detection failure logged + skipped, run still succeeds.
- Structured JSON logs (`server/log.ts`): `{level,ts,requestId,projectId?,event,durationMs?,meta}`. Ingestion logs per-date summaries, never per-row. **Never log secrets/tokens.**

## Frontend rules
- Server by default; `'use client'` only when stateful. Shell server-renders; table interacts client-side.
- Exploration state (filters/sort/cursor/selection) in the **URL** via `nuqs`. Server data via TanStack Query. **No global store.**
- DataTable stays generic over `Row`; cells dispatch on a `render` intent; columns from `src/contracts/ui/columns.ts`.
- **Null renders as `—`, never `0`.** Inversion banner is the hero of the drill.
- a11y: `role=grid`/`aria-sort`, keyboard nav, focus trap/return on drill, color never the only signal, reduced-motion respected.

## Testing
- Tests ship **with** the task (Vitest; one Playwright smoke). Mirror source under `test/`.
- Pure-function table tests for normalize/classify/scoring/action-table (incl. Eurofides cases).
- **Golden snapshot** on the Eurofides fixture (groups+severity+actions, with thresholds) = determinism + regression guard.
- DB test on ephemeral Postgres: RLS isolation + idempotent re-sync. Every commit leaves the tree green.

## Performance / caching / security
- Single fact scan per detection run; read aggregates only if they exist (they don't, in MVP).
- Stale-while-revalidate on filter changes; cache keys include `projectId`; never cache cross-project; no `localStorage` for server data.
- Chunk long syncs and resume via `last_synced_date`; no unbounded in-memory loads.
- Service key + `TOKEN_ENC_KEY` server-only (`import 'server-only'`); GSC tokens encrypted, never serialized/logged; `/api/cron/*` guarded by `CRON_SECRET`; validate all input with zod.

## Forbidden / preferred libraries
- **Preferred:** zod, TanStack Query, nuqs, TanStack Table, shadcn/ui + Tailwind + lucide-react, Recharts (when charts arrive), date-fns, `postgres`/Supabase raw SQL, Vitest + Playwright, SheetJS (export).
- **Forbidden:** any ORM (Prisma/Drizzle/etc.), global state store (Redux/Zustand/etc.), moment.js, CSS-in-JS runtime, a second data fetcher alongside Query, Express/custom server, `localStorage` for server data, LLM/embeddings in the detection path, a job queue (until a ROADMAP trigger).

## Size limits / abstraction
Files ≤300 lines (hard 400) · components ≤150 (hard 200) · functions ≤50 lines, ≤4 params · handlers ≤30 lines · PR ≤~400 LOC. Abstract on the **third** repetition. One module = one responsibility.

## Anti-patterns (do not do)
KPI-card landing (the **table** is the landing) · client-side sort/filter of a server-paginated set · `OFFSET` · `avg(position)` · row-by-row bulk writes · hard-deleting suppressed/benign groups (store the flag, filter in UI) · `group_key` from a run id (hash sorted member pages) · editing a merged migration · logic in handlers/components · a new fact index instead of an aggregate · modal "apply" filters (filters are live, in the URL) · `0` for missing data · embeddings as the detection signal.

## Forbidden architectural decisions
Second GSC property per project · real-time/streaming ingestion · non-deterministic or client-side detection · replacing the cron with external infra absent a measured limit · turning this into a general SEO suite · adding accounts/roles/RLS without a real multi-customer requirement (ROADMAP) · exposing `gsc_metric` to the client · crawling live pages/SERPs.

## Working agreement
1. Pick the next unblocked task from `MVP_TASKLIST.md`; one task per branch/PR; touch only that task's files.
2. Implement to acceptance criteria; write the listed tests; run `tsc --noEmit` + affected tests before commit.
3. Conventional commits; squash-merge; keep the tree green at every commit.
4. When a spec is ambiguous, state the assumption in the PR and pick the deterministic, lower-debt, easier-to-delete option.
