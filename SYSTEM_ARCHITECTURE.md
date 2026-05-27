# System Architecture

Lean, deterministic, single-purpose. One fact table, inline cron, no queue/aggregates/
matviews/partitioning. This document covers components, data flow, and boundaries;
`SSOT.md` is authoritative for details.

## Component map
```
┌─────────────────────────── Next.js (Vercel) ───────────────────────────┐
│  app/(app)/*  RSC pages ── client components (table, filters, drill)     │
│  app/api/*    route handlers (withHandler: parse→authorize→repo→envelope)│
│  app/api/cron/tick  ◄── Vercel Cron (daily)                              │
│                                                                          │
│  server/ ('server-only')                                                 │
│   ├─ db/        anonClient(RLS) · serviceClient(privileged)              │
│   ├─ auth · http(withHandler) · log                                      │
│   ├─ ingest/    normalize · gsc-client · persist                         │
│   ├─ engine/    detect · scoring · action-table                          │
│   ├─ repositories/  project · group · misc  (raw SQL → DTO)              │
│   └─ cron/tick  (sync→detect per project, inline)                        │
│                                                                          │
│  src/contracts/  types · zod schemas · utils · ui props/columns          │
│  lib/            api-client · query-client · search-params(nuqs)         │
└──────────────────────────────────────────────────────────────────────────┘
            │ service role (server)            │ anon + RLS (user reads)
            ▼                                    ▼
┌──────────────────── Supabase Postgres ────────────────────┐
│  gsc_metric (FACT)  ·  cannibalization_group/_member       │
│  group_state  ·  detection_run  ·  project/gsc_connection  │
│  account/app_user  ·  RLS on all tenant tables             │
└────────────────────────────────────────────────────────────┘
            ▲
            │ OAuth + searchanalytics.query
   Google Search Console API
```

## Boundaries
- **Client ↔ server:** client components never touch Supabase directly for writes; they call `/api/*`. Service-role code is `server-only` and must never reach a client bundle (build fails if it does).
- **Handlers ↔ logic:** route handlers are thin (parse→repo/service→return). All SQL is in repositories; all detection math is in `server/engine`.
- **Tenant:** RLS scopes every user-facing read by `account_id`; handlers also verify ownership/role. `gsc_metric` has no client policy — service-role only.
- **Types:** `src/contracts` is the only shared type surface and imports nothing Node/DB-bound. Request types are `z.infer` of the zod schemas (validation == types).

## Data flow

### Ingestion + detection (cron, inline)
```
Vercel Cron ─► POST /api/cron/tick (x-cron-secret)
  for each active project with a connected GSC:
    syncProject(incremental):
       GSC searchanalytics.query per date (paginate, retry, dataState=final)
       normalize query + classify page  (pure)
       COPY → unlogged staging → INSERT … ON CONFLICT  (idempotent per date)
       advance gsc_connection.last_synced_date
    detect(project, window):
       1 SQL pass: aggregate gsc_metric over window,
                   impression-weighted position, group by (query_norm,page),
                   gate by thresholds → candidates
       TS scoring: winner(max clicks) · cann_type · dominant(score) · inversion
                   · severity(V,S,P) · lost_clicks · benign(base_variant|mother_child)
       action table: deterministic recommended_action (8 rules, first match)
       persist: upsert groups by group_key, replace members,
                delete groups not seen this run; record detection_run
  (chunk + resume via last_synced_date if near the function timeout)
```
Manual `POST /sync` and `POST /detect` reuse the same per-project functions.

### Read (UI)
```
/p/:id/groups (RSC) ─► group.repo.list(filter,sort,cursor)  [keyset, no OFFSET]
                       └► hydrate client GroupTable
client filter/sort/paginate ─► URL (nuqs) ─► TanStack Query ─► /api/.../groups
drill ─► /p/:id/groups/[groupId] ─► group.repo.detail (group + json_agg members)
triage ─► PATCH /groups/:id/state ─► upsert group_state by group_key (optimistic)
overview ─► on-read aggregation of cannibalization_group by band
```

## Detection (the core, summarized)
Deterministic. Reproduces the manual analysis: competing-URL detection, winner by
clicks, slug-Jaccard consolidation, base/variant differentiation, intent-gated
collection/blog actions. Full formulas (severity weights, dominance, action table,
priors, thresholds) in `SSOT.md` §6 + Appendix A; the action enum is mirrored in the
DB CHECK and `src/contracts/types/domain.ts`. The **inversion flag** (winner ≠
dominant) is the highest-value signal: the page ranking isn't the one that should win.

## State model
- **Exploration state** (filters, sort, cursor, selection) → URL via `nuqs`. Shareable; back/forward works; no global store.
- **Server data** → TanStack Query (RSC initial fetch + client refetch/mutations).
- **Triage** → `group_state`, keyed by run-stable `group_key`, so status/notes survive re-runs.

## Deployment & ops
- GitHub → Vercel (preview per PR, `main`→prod). Migrations applied by CI before the dependent app deploy. Node runtime for service-role / `COPY` handlers.
- One Vercel Cron (`0 6 * * *`) → `/api/cron/tick`. No worker/queue infra.
- Logging: structured JSON with `requestId`; ingestion logs per-date summaries; secrets never logged. Errors classified (GSC auth/quota vs internal); per-group detection failures isolated.
- Rollback: redeploy previous Vercel build; DB forward-fix only.

## Scaling posture
Single fact table with two indexes handles low-tens-of-millions of rows; detection
is one scan over the window plus tiny per-group math. When real limits appear,
add the localized piece named in `PROJECT_ROADMAP.md` (partitioning, a matview, a
job queue, clustering, etc.) — the schema and contracts are forward-compatible.
The baseline deliberately avoids that complexity until a trigger fires.

## Security posture
RLS tenant isolation + handler ownership checks · service key & `TOKEN_ENC_KEY`
server-only · GSC refresh tokens encrypted at rest, never serialized/logged ·
`/api/cron/*` guarded by `CRON_SECRET` · all input validated by zod · `gsc_metric`
never exposed to the client · no live-page/SERP crawling (page type derives from URL).
