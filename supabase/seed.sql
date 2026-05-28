-- Seed data for local development and testing.
-- Idempotent: ON CONFLICT DO NOTHING on every insert.

insert into project (id, name, gsc_property, property_type, timezone)
values (
  '00000000-0000-0000-0000-000000000001',
  'Test Site',
  'sc-domain:example.com',
  'domain',
  'UTC'
)
on conflict do nothing;

insert into gsc_connection (project_id, google_sub, refresh_token_enc, scopes, status)
values (
  '00000000-0000-0000-0000-000000000001',
  'google-sub-test-123',
  '\x746573745f72656672657368',
  array['https://www.googleapis.com/auth/webmasters.readonly'],
  'connected'
)
on conflict do nothing;

-- 2 queries × 2 pages × 2 dates = 8 rows; material for a future detection run.
insert into gsc_metric (project_id, date, query, query_norm, page, page_type, clicks, impressions, position)
values
  ('00000000-0000-0000-0000-000000000001', '2024-01-01', 'best running shoes',   'best running shoes',   'https://example.com/shoes',              'collection', 120, 1500, 3.2),
  ('00000000-0000-0000-0000-000000000001', '2024-01-01', 'best running shoes',   'best running shoes',   'https://example.com/shoes/running',      'collection',  30,  800, 6.1),
  ('00000000-0000-0000-0000-000000000001', '2024-01-01', 'running shoes review', 'running shoes review', 'https://example.com/shoes',              'collection',  80,  900, 4.5),
  ('00000000-0000-0000-0000-000000000001', '2024-01-01', 'running shoes review', 'running shoes review', 'https://example.com/blog/running-shoes', 'blog',         50,  600, 5.8),
  ('00000000-0000-0000-0000-000000000001', '2024-01-02', 'best running shoes',   'best running shoes',   'https://example.com/shoes',              'collection', 115, 1480, 3.1),
  ('00000000-0000-0000-0000-000000000001', '2024-01-02', 'best running shoes',   'best running shoes',   'https://example.com/shoes/running',      'collection',  28,  790, 6.3),
  ('00000000-0000-0000-0000-000000000001', '2024-01-02', 'running shoes review', 'running shoes review', 'https://example.com/shoes',              'collection',  75,  880, 4.7),
  ('00000000-0000-0000-0000-000000000001', '2024-01-02', 'running shoes review', 'running shoes review', 'https://example.com/blog/running-shoes', 'blog',         48,  590, 5.9)
on conflict do nothing;
