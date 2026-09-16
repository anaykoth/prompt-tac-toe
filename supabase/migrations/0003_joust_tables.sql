-- Jousting online play. Same conventions as 0002: app connects as the table
-- owner, RLS enabled with no policies so the anon/PostgREST path stays shut.

create table if not exists public.joust_matches (
  id text primary key,
  state jsonb not null,
  version int not null default 0,
  finished boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per pass. Both seats' input traces land here; the server resolves
-- the pass from the traces (never from a client's claimed outcome).
create table if not exists public.joust_passes (
  match_id text not null references public.joust_matches(id) on delete cascade,
  pass_no int not null,
  seed bigint not null,
  starts_at timestamptz not null,
  traces jsonb not null default '{}'::jsonb,
  result jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (match_id, pass_no)
);

create table if not exists public.joust_presence (
  match_id text not null,
  seat int not null check (seat in (0, 1)),
  name text not null default '',
  spec jsonb,
  drunk real not null default 0,
  ready boolean not null default false,
  seen_at timestamptz not null default now(),
  primary key (match_id, seat)
);

alter table public.joust_matches enable row level security;
alter table public.joust_passes enable row level security;
alter table public.joust_presence enable row level security;
