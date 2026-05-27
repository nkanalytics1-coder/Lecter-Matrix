-- Single-tenant: no account/app_user tables, no account_id on project.
create table project (
  id            uuid      primary key default gen_random_uuid(),
  name          text      not null,
  gsc_property  text      not null,               -- 'sc-domain:…' | 'https://…'
  property_type text      not null,               -- 'domain' | 'url_prefix'
  timezone      text      not null default 'UTC',
  config        jsonb     not null default '{}'::jsonb,
  status        text      not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_project_property
    unique (gsc_property),
  constraint ck_project_property_type
    check (property_type in ('domain','url_prefix')),
  constraint ck_project_status
    check (status in ('active','paused','error'))
);

create table gsc_connection (
  project_id        uuid    primary key references project(id) on delete cascade,
  google_sub        text    not null,
  refresh_token_enc bytea   not null,             -- encrypted at rest (app-side)
  scopes            text[]  not null,
  last_synced_date  date,
  status            text    not null default 'connected',
  updated_at        timestamptz not null default now(),
  constraint ck_gsc_status
    check (status in ('connected','revoked','error'))
);
