-- Prompt-tac-toe schema. The app connects as the postgres role (table owner),
-- which RLS does not apply to; RLS-on-with-no-policies locks out the project's
-- default PostgREST/anon key path entirely.
create table if not exists public.ttt_games (
  date text primary key,
  state jsonb not null,
  version int not null default 0,
  finished boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.ttt_results (
  date text primary key,
  winner text not null check (winner in ('X','O','D')),
  x_boards int not null,
  o_boards int not null,
  reason text not null,
  moves int not null,
  created_at timestamptz not null default now()
);

alter table public.ttt_games enable row level security;
alter table public.ttt_results enable row level security;
