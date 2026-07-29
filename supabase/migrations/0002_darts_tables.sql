-- Splinter Alley online play. Same conventions as the tic-tac-toe tables: the
-- app connects as the postgres role (table owner, RLS does not apply), and RLS
-- is enabled with no policies so the project's anon/PostgREST path stays shut.

-- One live leg. `state` is the serialised Match plus per-seat presence.
create table if not exists public.darts_matches (
  id text primary key,
  state jsonb not null,
  version int not null default 0,
  finished boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only log of every dart. This is the real source of truth: a client
-- that reloads or joins late replays the log to rebuild the board exactly,
-- and the server re-simulates each entry to score it rather than trusting
-- whatever the throwing browser claimed.
create table if not exists public.darts_throws (
  match_id text not null references public.darts_matches(id) on delete cascade,
  seq int not null,
  seat int not null check (seat in (0, 1)),
  launch jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, seq)
);

create index if not exists darts_throws_match_seq on public.darts_throws (match_id, seq);

-- Who is at the oche, what they look like, and how many they have had.
create table if not exists public.darts_presence (
  match_id text not null,
  seat int not null check (seat in (0, 1)),
  name text not null default '',
  spec jsonb,
  drunk real not null default 0,
  seen_at timestamptz not null default now(),
  primary key (match_id, seat)
);

alter table public.darts_matches enable row level security;
alter table public.darts_throws enable row level security;
alter table public.darts_presence enable row level security;
