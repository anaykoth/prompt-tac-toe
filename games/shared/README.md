# Live play: the shared layer

Two people, one browser each, playing the same match. This folder holds the
part that is the same for every game in the repo. Each game keeps its own
rules, its own tables, its own routes and its own client session.

```
games/shared/net/live.js       LiveLink, SeenIds, ServerClock, readToken
games/shared/test/livecheck.mjs
npm run test:shared
```

A game imports it relatively (`../../../shared/net/live.js` from
`games/*/src/net/`). It needs `@supabase/realtime-js`, a dependency of both
game workspaces and hoisted to the root `node_modules`.

| export | what |
|---|---|
| `LiveLink` | one Supabase Realtime broadcast channel per game: named events, per-event send ceilings, seat filtering, presence of the two seats |
| `SeenIds` | remembers ids so an echo and the poll act on each thing exactly once |
| `ServerClock` | offset to the server's clock from every reply's `now` and that request's round trip; keeps the lowest-rtt sample of the last eight so a cold start cannot skew it |
| `readToken` | `?t=` once, then localStorage; the tic-tac-toe player token convention |

## The pattern

Every live game is two tiers.

1. **Authoritative: token-gated HTTP over an append-only log in Postgres.**
   Identity is the player token (seat 0 = X = Anay, seat 1 = O = Jake). The
   client sends inputs, never outcomes. The server re-runs the same
   deterministic simulation the browser previewed with and stores the result.
   Clients poll: 3.5 s idle, 650 ms while something is live. A reload
   replays the log.
2. **Spectacle: a broadcast channel** (`LiveLink`), one channel name per
   game. It streams whatever makes the other person feel present and echoes
   decisive moments the instant they happen. Nothing on it is trusted:
   `SeenIds` dedupes the echo against the poll, streams decay when packets
   stop, and if the socket drops the game degrades to plain polling.

## Darts (Splinter Alley)

`games/darts/src/net/online.js` (polling session over `/api/darts/*`) and
`games/darts/src/net/live.js` (aim stream at ~22 packets/s from the thrower,
plus an instant launch echo deduped by seed). Darts predates this folder and
still carries its own copy of the channel code: its own `LiveLink` and a
`SeenSeeds` that only knows launch seeds. The shared exports are the
generalised version of it.

Verified live on prod on 2026-09-16 with two isolated browsers: both seats
online, the launch echo reached the other page in 18 to 35 ms (median 22 ms,
n=19), every dart converged to the server's score on both screens, and no
score ever came off the channel. Scoring never moved off the token-gated
API.

## Jousting (Tilt Alley)

Both riders act at the same time, which is why `ServerClock` exists.

**Client** (`games/joust/src/net/`):

- `online.js`: `JoustSession`, a polling session over `/api/joust/*`. Every
  reply carries the server's `now` and feeds the clock; the countdown, the
  charge and the pass are read off that clock, never off `Date.now()`.
- `live.js`: a `LiveLink` wrapper on channel `tilt-alley-live` with three
  events (`ticks`, `ready`, `ended`) and `RemoteLog`, which accumulates the
  other seat's tick batches into a sparse log and holds the last tick across
  a gap, so a stuttering stream freezes the rider mid-posture instead of
  snapping them to neutral.

**Server** (`lib/joust.mjs`, `lib/joust-api.mjs`, `app/api/joust/*`):

- The wire unit is a log: one packed tick per 60 Hz input sample,
  `[leanX, leanY, aimX, aimY, flags]` from `spec.js packInput`. A null hole
  (a frame that skipped a tick) is allowed; the sim holds the previous tick
  across it, so a browser rendering below 60 fps still produces a valid log.
- The resolver is `simulatePass` from `games/joust/src/game/pass.js`, the
  same `PassSim` the browsers preview with. Both riders' drunk levels are
  frozen into the pass row when it is armed (migration 0004, `riders`
  column) so browsers and server seed the same noise.
- The match state is the game's own `Match` from `rules.js` (best of N,
  sudden death, to the unhorsing), applied server side the way
  `lib/darts.mjs` applies the darts `Match`.
- Arming: a seat's `ready` is also a heartbeat. When both seats are ready
  and online, one insert wins the race (primary key) and the pass carries a
  seed, the frozen riders and `starts_at = now + 3 s`.
- Logs land by one atomic jsonb merge that returns the merged logs, so two
  logs posted in the same instant cannot each miss the other.
- Resolution is a single claim on the pass row (`resolved_at` where
  unclaimed). The claimant runs the sim and writes `result` once, complete,
  so readers never see a half-written verdict. A claim older than 10 s with
  no result belongs to an owner that died and may be taken over.
- A pass nobody finishes is swept on the next read: after its latest
  possible end (9 s cap plus the lag) or the present log's end, plus a 5 s
  grace, the missing log becomes a default log (an idle rider) and the pass
  resolves. A dropped opponent is a pass you win, never a stall.
- Timing is served to clients in every snapshot: `countdownMs 3000`,
  `lagTicks 12` (each browser starts its sim that many ticks after T0 so the
  other rider's ticks have arrived), `tickHz 60`, `passMaxS 9`,
  `graceMs 5000`, `maxSamples 542`.

**Tables** (`0003_joust_tables.sql`, `0004_joust_pass_riders.sql`):

| table | what |
|---|---|
| `joust_matches` | `id` (`'live'`), `state` (`{ match: Match.toJSON() }`), `version`, `finished` |
| `joust_passes` | `(match_id, pass_no)`, `seed`, `starts_at`, `riders` (frozen drunk per seat), `traces` (`{"0": log, "1": log}`), `result`, `resolved_at` |
| `joust_presence` | `(match_id, seat)`, `name`, `spec`, `drunk`, `ready`, `seen_at`; online means seen within 25 s |

RLS on, no policies, the app connects as the table owner. Same as darts.

**Routes** (all `force-dynamic`, all token-gated, every reply carries `now`):

| route | does |
|---|---|
| `POST join` | presence upsert (name, spec, drunk); `newMatch: true` resets a finished match; returns seat, match, passes, open pass, seats, timing |
| `GET state?since=<pass_no>&t=<token>` | the same snapshot, passes newer than `since` |
| `POST ready` | `{ drunk? }`; returns the open pass, `armed: true` for the caller that armed it |
| `POST trace` | `{ pass_no, trace, drunk? }`; returns `waiting` or the resolved `result` plus the match |
| `POST presence` | heartbeat with `drunk` |

## Realtime message budget

The Free plan allows 100 Realtime messages per second per project and
disconnects clients above it (they reconnect once the rate drops). Every
delivery counts, not only every send.

| stream | rate | messages per second |
|---|---|---|
| darts aim, one thrower | ~22 packets/s | ~44 |
| joust riders, both streaming | 60 Hz batched every 6 ticks = 10 packets/s each | ~40 |
| joust ready/ended, darts launch echo, presence | occasional | a few |

The joust batch size (`BATCH_TICKS`) and the lag the remote rider is drawn at
(`LAG_TICKS`) live in `games/joust/src/net/live.js`; the server's own
`lagTicks` (12, the offset each browser starts its sim at) is in `TIMING` in
`lib/joust.mjs`. The two games are the same two people, so they never stream
at once.

**Which project carries the channel.** Both games still ride the Diyona CRM
project's Realtime (`iibtglstfscurtiqpeuc`), which is a live business system,
not the game's. The game's own project is `ouusnzcvfkbhifeptpwz` ("Tic Tac
Toe", org "Games", ca-central-1), and no Supabase connector on this machine
can reach it: as of 2026-09-16 neither account-wide connector lists the Games
org at all, and asking for that ref's keys directly is refused for want of
privileges.

To move the games onto their own quota, Anay pastes that project's
publishable key (Supabase dashboard, project `ouusnzcvfkbhifeptpwz`, Project
Settings, API, the `anon` or `sb_publishable_...` key) into `RT_KEY` in these
two files, and sets `RT_URL` in both to
`wss://ouusnzcvfkbhifeptpwz.supabase.co/realtime/v1`:

- `games/shared/net/live.js` (joust and anything new)
- `games/darts/src/net/live.js` (darts keeps its own copy)

Publishable keys are public by design; the database behind them is
RLS-locked shut and the channel never touches it.

## Tests

- `npm run test:shared`: the shared layer through a fake channel (routing by
  event, seat filtering, throttling, presence, `SeenIds`, the clock's
  lowest-rtt rule).
- `node games/darts/test/livecheck.mjs`: darts' echo and poll dedupe.
- `games/joust/test/onlinecheck.mjs`: the joust client with no browser. Dense
  packed logs, `RemoteLog` across dropped and reordered batches, and two
  `JoustSession`s driven in process through one whole pass.
- `games/joust/test/servercheck.mjs`: the joust server against a real
  Postgres, 74 checks: the arming race, two logs in the same instant, late and
  abandoned passes, best of five, sudden death, to the unhorsing, a broken
  resolver, a half-written result. Start the throwaway cluster first:

```
npm run test:pg start     # Homebrew postgres on 127.0.0.1:54371, all migrations applied
npm run test:joust        # physics, pass, rules, then the server check
npm run test:pg stop
```

Without a reachable test database the server check prints SKIPPED and exits
0 so the rest of the chain still runs; a green run that says SKIPPED is not a
green server.
