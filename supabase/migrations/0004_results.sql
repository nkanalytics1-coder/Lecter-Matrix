create table detection_run (
  id bigint generated always as identity primary key,
  project_id uuid not null references project(id) on delete cascade,
  window_start date not null,
  window_end date not null,
  status text not null default 'running',
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
  group_key text not null,
  query_norm text not null,
  query_intent text not null default 'unknown',
  search_volume int,
  cann_type text not null,
  total_clicks int not null,
  total_impressions int not null,
  member_count smallint not null,
  severity real not null,
  winner_page text,
  dominant_page text,
  inversion boolean not null default false,
  benign boolean not null default false,
  benign_reason text,
  recommended_action text not null,
  lost_clicks int not null default 0,
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
  status text not null default 'open',
  notes text,
  updated_at timestamptz not null default now(),
  primary key (project_id, group_key),
  constraint ck_state_status check (status in ('open','in_progress','resolved','ignored'))
);
