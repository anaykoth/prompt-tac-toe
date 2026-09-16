# Live play: the shared layer

Two people, one browser each, playing the same match. This folder holds the
part that is the same for every game in the repo; each game keeps its own
rules, its own tables and its own routes.

```
games/shared/net/live.js     LiveLink, SeenIds, ServerClock, readToken
games/shared/test/livecheck.mjs
npm run test:shared
```

Import it relatively from a game (`../../shared/net/live.js`); it needs
`@supabase/realtime-js`, which the root workspace already hoists.

## The pattern (proven in darts, verified live on prod 2026-09-16)

Every live game is two tiers:

1. **Authoritative: token-gated HTTP + an append-only log in Postgres.**
   Identity is the tic-tac-toe player token (`?t=` once, then localStorage;
   seat 0 = X = Anay, seat 1 = O = Jake). The client sends *inputs*, never
   outcomes. The server re-runs the same deterministic sim the client uses
   and stores the result. Clients poll (3.5 s idle, 650 ms while waiting on
   the other seat), and a reload replays the log to rebuild the scene.
2. **Spectacle: a Supabase Realtime broadcast channel** (`LiveLink`), one
   channel name per game. Streams whatever makes the other person feel
   present (aim, lance, lean) at ~22 Hz and echoes decisive moments the
   instant they happen. Nothing on it is trusted: `SeenIds` dedupes the echo
   against the poll, streams decay when packets stop, and if the socket
   drops the game degrades to plain polling.

Darts wires exactly this in `games/darts/src/net/` (its own copy for now;
swapping it to the shared module is a mechanical change, not done yet so the
darts build stays untouched today).

## Wiring jousting

Jousting differs from darts in one way that matters: both riders act **at the
same time**. That is why `ServerClock` exists. Everything else is the darts
recipe with the nouns changed.

### Tables (migration `0003_joust_tables.sql`, same conventions as 0002)

| table | what |
|---|---|
| `joust_matches` | `id text pk` (`'live'`), `state jsonb` (score, pass count, winner), `version`, `finished` |
| `joust_passes` | `(match_id, pass_no) pk`, `seed int`, `starts_at timestamptz`, `traces jsonb` (`{"0": [...], "1": [...]}`), `result jsonb null`, `resolved_at` |
| `joust_presence` | `(match_id, seat) pk`, `name`, `spec`, `drunk`, `seen_at` — identical to `darts_presence` |

RLS on, no policies, app connects as the table owner. Same as everything else.

### Routes (`app/api/joust/*`, all `force-dynamic`, all token-gated like darts)

Every reply carries `now: Date.now()` so the client can `clock.sync(now, rtt)`.

| route | does |
|---|---|
| `POST join` | presence upsert, returns seat, match state, open pass, `now` |
| `GET state?since=<pass_no>` | match + passes newer than `since` + presence + `now` |
| `POST ready` | marks this seat ready for the next pass. When both are ready the server inserts the pass with `seed` (random uint32) and `starts_at = now() + 3 s`, and returns it. Optimistic `version` check exactly like `saveMatch` in `lib/darts.mjs` |
| `POST trace` | `{ pass_no, trace }` — this seat's input samples for the pass. Validated (length, sample ranges), stored into `traces[seat]`. When both seats' traces are present, resolve and store `result` |
| `POST presence` | heartbeat with `drunk`, like darts |

A pass whose second trace has not arrived 5 s after contact time is resolved
with a **default trace** for the missing seat (lance straight, no lean), so a
dropped connection is a miss, never a stall.

### The pass, second by second

```
both ready ─► server: seed + starts_at (T0 = now + 3 s)
   poll/echo ─► both clients: countdown on ServerClock.until(starts_at)
T0           charge. Horses run the FIXED timeline: pos(t) is a pure function
             of t, no player control of speed. Contact is at Tc (pick ~3.0 s).
T0..Tc       each client samples its own input on a fixed 20 Hz tick from T0:
               { t, yaw, pitch, lean, sway }   (mouse = lance, WASD = waist)
             and streams the same samples on LiveLink event 'rider' (rate 45).
             The opponent is animated from that stream, interpolated ~100 ms
             behind. Drunk sway is applied to the INPUT before sampling, so
             the trace already contains it and the resolver never guesses.
Tc           client POSTs its trace. Locally: play the clash (dust, thud,
             crowd gasp) but show NO verdict.
Tc + 0.3-0.6 s  poll returns `result` ─► play the resolved impact as a slow-
             motion replay: hit zone, points, unhorse. The latency becomes
             the replay, which is what a broadcast would do anyway.
```

### The resolver is pure and lives in one file

`games/joust/src/game/pass.js` exports `resolvePass(traceA, traceB, seed)`:
no three.js, no DOM, no `Math.random` (draw from `game/rng.js` seeded by
`seed`, exactly as darts does per throw). `lib/joust.mjs` imports it the way
`lib/darts.mjs` imports `replay.js`, so the browser preview and the server
verdict are the same code by construction. Give it a `test/netcheck.mjs` that
runs a few hundred passes down both paths and asserts identical results.

Shape of the result the client plays back:

```json
{ "hits": [ { "seat": 0, "zone": "shield", "points": 1 },
            { "seat": 1, "zone": "helm",   "points": 3 } ],
  "unhorsed": 1, "score": [4, 7], "passNo": 3 }
```

### Client wiring, in the order darts does it

1. `readToken()` at boot (darts now does this too) so the player link sticks.
2. `JoustSession` = a copy of `games/darts/src/net/online.js` with
   `join/state/ready/trace` in place of `join/state/throw`, plus a
   `ServerClock` fed from every reply.
3. `new LiveLink({ channel: 'joust-live', seat, on: { rider, charge }, rate: { rider: 45 } })`.
4. Remote passes are **played, never scored locally**. Whatever the local
   preview thought happened at contact, the server's `result` is the one
   that changes the scoreboard.
5. Presence pill in the HUD from `seats[].online || liveSeats.has(theirSeat)`.

### Also needed, mechanical

- `games/joust` npm workspace with a Vite build into `public/joust/`
  (gitignore it like `public/darts/`), one rewrite in `next.config.mjs`
  (`/joust` → `/joust/index.html`), a `build` step in the root `package.json`.
- `npm run migrate` picks up `0003` automatically (the runner applies every
  file in order and is safe to re-run).
