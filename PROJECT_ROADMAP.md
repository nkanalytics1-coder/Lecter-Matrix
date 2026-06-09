# Project Roadmap

Phased plan. Build Phase 0 → 1 (the MVP). Everything past Phase 1 is **trigger-gated**:
add it only when the listed real signal fires, never preemptively. The MVP schema and
contracts are forward-compatible with all of it.

## Phase 0 — Foundation
Goal: an empty app that builds, deploys, and has its contracts in place.
- Scaffold (Next + TS strict + Tailwind + shadcn), CI (typecheck/lint/test/build), `src/env.ts`.
- `src/contracts/*` (types, zod schemas, utils, UI prop/column defs).
- Migrations 0001–0005 (tenancy, fact, results, RLS) + migration/RLS smoke test.
- Server core: db clients, auth, `withHandler`, logging.
Exit: CI green; migrations apply on clean Postgres; RLS isolates tenants.

## Phase 1 — MVP (shippable product)
Goal: connect GSC → detect cannibalization → triage → export. See `MVP_TASKLIST.md`.
- Ingestion: normalize/classify, GSC client (paginate + retry), idempotent date upsert.
- Engine: 1 SQL pass + scoring + action table → results; golden snapshot on Eurofides fixture.
- Cron `tick` (inline sync→detect per project) + manual sync/detect routes.
- API: project CRUD, GSC connect, groups list/detail, overview, export, triage.
- UI: shell, groups table (keyset, no virtualization), filters + presets, drill route, overview, settings, onboarding, loading/error/empty states.
- Deploy: Vercel cron + env; one E2E smoke. Tag `v0.1.0`.
Exit: an analyst onboards a property and acts on real cannibalization findings.

## v0.2.0 — BigQuery migration (complete 2026-06-09)
Backend storage migrated from Supabase Postgres to Google BigQuery / Cloud Run.
All Postgres migrations, `serviceClient()`, and Supabase-based repos replaced with BQ equivalents.
Test suite adapted: server-only and Postgres-dependent tests removed/skipped; engine, ingest,
contracts, and API tests all BQ-clean. `npx vitest run` green (312 tests), `tsc --noEmit` clean,
`npm run build` clean.

## v0.2 — UX improvements
Planned post-MVP quality-of-life work; no trigger required.

- **Property picker post-OAuth**: oggi il wizard chiede la property prima di OAuth; se la property non è nell'account Google scelto, l'utente lo scopre tardi. Invertire il flusso: prima OAuth, poi mostrare la lista delle property accessibili via GSC API `sites.list`, e l'utente sceglie. Modifiche: nuova route `GET /api/projects/[id]/gsc/sites` (chiama `sites.list`), nuovo step wizard tra OAuth e creazione progetto, logica di aggiornamento della property in Settings.

## Trigger-gated features (Phase 2+)
Each is a localized addition, not a rewrite.

| Trigger (real signal observed) | Add | Touches |
|---|---|---|
| A project's `gsc_metric` crosses ~50M rows or window scans slow | Month range-partitioning (`pg_partman`) + daily→monthly rollup table | DB + ingest + engine read |
| Group-list / overview reads slow with many projects/users | Severity-distribution materialized view for `/overview` | DB + overview repo |
| Syncs overlap/contend; many projects onboarded; cron times out | Postgres job queue (`FOR UPDATE SKIP LOCKED`) + worker tick; move sync/detect off the request | server/jobs + cron |
| Users ask "which queries should I group?" / typos fragment data | Deterministic **shared-URL** query clustering (queries co-ranking on the same URLs); lexical tier next; embeddings only if still insufficient | engine + DB (cluster table) |
| Users want "is this getting worse?" / volatility | Temporal instability + precomputed `daily_query_winner` table + trend chart in drill | DB + engine + UI |
| Results flicker run-to-run near thresholds | Threshold hysteresis (lower bar to stay than to appear) + `runs_seen` confirmation | engine |
| A customer wants notifications | Outbox + signed (HMAC) webhook delivery | server/events + DB |
| Result trust questioned on thin data | Confidence score (data sufficiency × signal strength − benign); sort by `severity × confidence` | engine + UI sort |
| Power users live in the tool | Command palette, full keyboard model, row virtualization (only if accumulating thousands of rows) | UI |
| Multi-user teams need permissions | Expand `role` to owner/admin/member/viewer + role guards | auth + API |
| Storage/joins on the fact hurt | Promote query/page to dimension tables + `url_hash` | DB + ingest |
| Prioritization needs search volume | Populate `search_volume` via an enrichment adapter (e.g. DataForSEO) | ingest + DB |

## Explicitly out of scope (product boundary)
Backlinks, rank tracking beyond GSC, site crawling, competitor-domain analysis,
keyword research, automatic on-site changes, multi-property projects, real-time
streaming. These change the product's identity and are not on the roadmap.

## Principle
Build the small thing first. Let real usage — not anticipated load — pull complexity in.
Every Phase 2+ item must point to an observed trigger before it starts.
