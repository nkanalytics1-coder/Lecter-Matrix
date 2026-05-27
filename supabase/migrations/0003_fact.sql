-- Query/page stored as text (no dimension tables for MVP).
-- query_norm is the normalized group/dedup key.
-- PK enables idempotent date upsert via ON CONFLICT.
create table gsc_metric (
  project_id  uuid not null references project(id) on delete cascade,
  date        date not null,
  query       text not null,                      -- raw (display)
  query_norm  text not null,                      -- normalized
  page        text not null,
  page_type   text not null default 'unknown',    -- collection|blog|product|other|unknown
  clicks      int  not null default 0,
  impressions int  not null default 0,
  position    real not null default 0,
  primary key (project_id, date, query_norm, page),
  constraint ck_metric_type
    check (page_type in ('collection','blog','product','other','unknown')),
  constraint ck_metric_nonneg
    check (clicks >= 0 and impressions >= 0 and position >= 0)
);

create index ix_metric_q    on gsc_metric (project_id, query_norm); -- detection scan
create index ix_metric_date on gsc_metric (project_id, date);       -- sync/retention
-- Exactly two indexes. New access pattern → aggregate table (ROADMAP), never a third fact index.
