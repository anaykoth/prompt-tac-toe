-- The drunk level of each rider is frozen into the pass when it is armed, so
-- both browsers and the server seed the same noise into the same simulation.
alter table public.joust_passes
  add column if not exists riders jsonb not null default '[{"drunk":0},{"drunk":0}]'::jsonb;
