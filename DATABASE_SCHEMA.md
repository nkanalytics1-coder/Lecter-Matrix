# Database Schema

Postgres (Supabase). Migrations in `supabase/migrations/`, applied in order on a
clean DB. RLS on every tenant table. Raw SQL only (no ORM). DTOs are camelCase;
columns are snake_case; the repository mapper is the only crossing point.

## Tables at a glance
| Table | Role | Grows to |
|---|---|---|
| `account`, `app_user` | tenancy | small |
| `project`, `gsc_connection` | one GSC property per project | small |
| `gsc_metric` | **fact** — daily `(query, page)` performance | millions/project |
| `detection_run` | run audit | small |
| `cannibalization_group` / `_member` | detection results (rewritten each run) | thousands |
| `group_state` | triage, run-stable via `group_key` | thousands |

No partitioning, no aggregate tables, no materialized views (see ROADMAP triggers).

## 0001 — extensions
```sql
create extension if not exists pgcrypto;   -- gen_random_uuid()
-- pg_cron is provided by Supabase scheduling; not needed for local tests.
```

## 0002 — tenancy
```sql
create table account (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table app_user (
  id uuid primary key,                          -- = auth.users.id
  account_id uuid not null references account(id) on delete cascade,
  email text not null unique,
  role text not null default 'member',          -- MVP: owner|member
  created_at timestamptz not null default now(),
  constraint ck_app_user_role check (role in ('owner','member'))
);
create index ix_app_user_account on app_user (account_id);

create table project (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account(id) on delete cascade,
  name text not null,
  gsc_property text not null,                    -- 'sc-domain:…' | 'https://…'
  property_type text not null,                   -- 'domain' | 'url_prefix'
  timezone text not null default 'UTC',
  config jsonb not null default '{}'::jsonb,     -- thresholds/weights/rules (Appendix A of SSOT)
  status text not null default 'active',         -- active|paused|error
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_project_account_property unique (account_id, gsc_property),
  constraint ck_project_property_type check (property_type in ('domain','url_prefix')),
  constraint ck_project_status check (status in ('active','paused','error'))
);
create index ix_project_account on project (account_id);

create table gsc_connection (
  project_id uuid primary key references project(id) on delete cascade,
  google_sub text not null,
  refresh_token_enc bytea not null,              -- encrypted at rest (app-side)
  scopes text[] not null,
  last_synced_date date,
  status text not null default 'connected',      -- connected|revoked|error
  updated_at timestamptz not null default now(),
  constraint ck_gsc_status check (status in ('connected','revoked','error'))
);
```

## 0003 — fact
```sql
-- Query/page stored as text (no dimension tables for MVP). query_norm is the
-- normalized group/dedup key. PK enables idempotent date upsert.
create table gsc_metric (
  project_id  uuid not null references project(id) on delete cascade,
  date        date not null,
  query       text not null,                     -- raw (display)
  query_norm  text not null,                     -- normalized
  page        text not null,
  page_type   text not null default 'unknown',   -- collection|blog|product|other|unknown
  clicks      int  not null default 0,
  impressions int  not null default 0,
  position    real not null default 0,
  primary key (project_id, date, query_norm, page),
  constraint ck_metric_type
    check (page_type in ('collection','blog','product','other','unknown')),
  constraint ck_metric_nonneg
    check (clicks >= 0 and impressions >= 0 and position >= 0)
);
create index ix_metric_q    on gsc_metric (project_id, query_norm);  -- detection scan
create index ix_metric_date on gsc_metric (project_id, date);        -- sync/retention
```
Exactly two indexes. A new access pattern → an aggregate table (ROADMAP), never a third fact index.

## 0004 — runs, results, triage
```sql
create table detection_run (
  id bigint generated always as identity primary key,
  project_id uuid not null references project(id) on delete cascade,
  window_start date not null,
  window_end date not null,
  status text not null default 'running',        -- running|succeeded|failed
  groups_found int,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ck_run_status check (status in ('running','succeeded','failed')),
  constraint ck_run_window check (window_end >= window_start)
);
create index ix_run_project on detection_run (project_id, started_at desc);

create table cannibalization_group (
  id bigint generated always as identity primary key,
  project_id uuid not null references project(id) on delete cascade,
  group_key text not null,                       -- sha256(project|query_norm|sorted pages)
  query_norm text not null,
  query_intent text not null default 'unknown',  -- informational|transactional|navigational|unknown
  search_volume int,                             -- optional enrichment, nullable
  cann_type text not null,                        -- collection_vs_collection|collection_vs_blog|blog_vs_blog|mixed
  total_clicks int not null,
  total_impressions int not null,
  member_count smallint not null,
  severity real not null,                         -- 0..100; band derived in app, not stored
                                                  -- (critical>=70, high 50-69.9, medium 30-49.9, low<30; see API_SPEC)
  winner_page text,                               -- currently ranking (max clicks)
  dominant_page text,                             -- should win (scoring)
  inversion boolean not null default false,       -- winner != dominant
  benign boolean not null default false,          -- intended coexistence
  benign_reason text,                             -- base_variant|mother_child|null
  recommended_action text not null,
  lost_clicks int not null default 0,             -- opportunity estimate
  updated_at timestamptz not null default now(),
  constraint uq_group unique (project_id, group_key),
  constraint ck_group_intent
    check (query_intent in ('informational','transactional','navigational','unknown')),
  constraint ck_group_canntype
    check (cann_type in ('collection_vs_collection','collection_vs_blog','blog_vs_blog','mixed')),
  constraint ck_group_action
    check (recommended_action in (
      'consolidate_301','differentiate_variant_onpage',
      'despine_blog_to_collection','reposition_collection_strengthen_blog',
      'interlink_blog_to_collection','reduce_blog_overlap_or_canonical',
      'consolidate_blog_cluster','differentiate_onpage'))
);
create index ix_group_list on cannibalization_group (project_id, severity desc, id desc);
create index ix_group_key  on cannibalization_group (project_id, group_key);
create index ix_group_inv  on cannibalization_group (project_id) where inversion = true;

create table cannibalization_member (
  group_id bigint not null references cannibalization_group(id) on delete cascade,
  page text not null,
  page_type text not null,
  clicks int not null,
  impressions int not null,
  position real not null,
  is_winner boolean not null default false,
  primary key (group_id, page)
);

create table group_state (
  project_id uuid not null references project(id) on delete cascade,
  group_key text not null,
  status text not null default 'open',            -- open|in_progress|resolved|ignored
  notes text,
  updated_at timestamptz not null default now(),
  primary key (project_id, group_key),
  constraint ck_state_status check (status in ('open','in_progress','resolved','ignored'))
);
```

## 0005 — RLS
```sql
create or replace function current_account_id() returns uuid
  language sql stable as $$ select account_id from app_user where id = auth.uid() $$;

alter table account                enable row level security;
alter table app_user               enable row level security;
alter table project                enable row level security;
alter table gsc_connection         enable row level security;
alter table cannibalization_group  enable row level security;
alter table cannibalization_member enable row level security;
alter table group_state            enable row level security;
alter table detection_run          enable row level security;
alter table gsc_metric             enable row level security;   -- server-only; no client policy

create policy account_self on account for select using (id = current_account_id());
create policy user_same    on app_user for select using (account_id = current_account_id());
create policy project_tenant on project using (account_id = current_account_id());
create policy gsc_tenant on gsc_connection using (
  exists (select 1 from project p where p.id = gsc_connection.project_id
          and p.account_id = current_account_id()));
create policy group_tenant on cannibalization_group using (
  project_id in (select id from project where account_id = current_account_id()));
create policy member_tenant on cannibalization_member using (
  exists (select 1 from cannibalization_group g join project p on p.id = g.project_id
          where g.id = cannibalization_member.group_id
            and p.account_id = current_account_id()));
create policy state_tenant on group_state using (
  project_id in (select id from project where account_id = current_account_id()))
  with check (project_id in (select id from project where account_id = current_account_id()));
create policy run_tenant on detection_run using (
  project_id in (select id from project where account_id = current_account_id()));
-- gsc_metric: no client policy → service role only.
```

## Key relationships
```
account 1─∞ app_user
account 1─∞ project 1─1 gsc_connection
project 1─∞ gsc_metric                       (FACT)
project 1─∞ detection_run                    (audit)
project 1─∞ cannibalization_group 1─∞ cannibalization_member
project 1─∞ group_state                      (triage; joined to groups by group_key)
```

## Write patterns
- **Ingestion (idempotent):** `COPY` rows → unlogged staging → single `INSERT INTO gsc_metric … ON CONFLICT (project_id,date,query_norm,page) DO UPDATE`. One tx per date. Re-running a date overwrites it.
- **Detection:** per run, upsert groups by `(project_id, group_key)`, replace members, **delete** groups for the project not seen this run (table always reflects the latest run). `group_state` survives because it's keyed by `group_key`.
- **Retention (when needed):** `delete from gsc_metric where project_id=$1 and date < now() - interval '16 months'`.

## Read patterns
- **Detection scan** (one pass): aggregate `gsc_metric` over the window, impression-weighted position `sum(position*impressions)/nullif(sum(impressions),0)`, grouped by `(query_norm, page)`; gate by thresholds. Uses `ix_metric_q`.
- **Group list (keyset):** `where project_id=$1 [+ filters] and (severity,id) < (:cur) order by severity desc, id desc limit :n`. Uses `ix_group_list`. **No OFFSET.**
- **Drill:** group + `json_agg` of members (single query, no N+1).
- **Triage join:** `left join group_state using (project_id, group_key)`.
