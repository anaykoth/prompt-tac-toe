# Multiplayer services

The game host is a persistent Node/WebSocket process. Next.js still serves
Tic-Tac-Toe, Darts and Joust and their Postgres APIs. The same game host serves
the Muppet games and the authenticated live relay. No game traffic uses the
CRM's Realtime project.

## Rooms and teams

The pub owns identities and lobby membership (24 connected people per lobby).
Each lobby can contain up to 12 independent air-hockey tables. A table has its
own roster, physics state, input acknowledgements, epoch and rematch votes.
Choose 1v1, 2v2, 3v3 or 4v4 in Air Hockey → Table Settings. Everyone joins the
same lobby and selects the same table. The Sun/Moon buttons select the next
available seat on that team. Unseated players can spectate; a match begins once every playing slot is filled.

`matches.js` is the shared roster contract; it supports arbitrary team shapes
up to 24 playing slots, while each game's adapter chooses its supported shape.
Air hockey currently implements two equal teams. The existing darts/joust rules
remain two-player. Their `?room=<match-id>` URL scopes both HTTP state and relay
traffic; the existing X/O player tokens determine seats in those two games.
New users join pub games through their room identity rather than X/O tokens.

## Timing and authority

- Air hockey runs on the server at 120 Hz, with 480 Hz contact substeps.
  Clients collect 60 Hz numbered inputs and send batches at about 30 Hz.
  Acknowledgements describe commands actually simulated, including a partial
  command. Clients replay their outstanding inputs for the local mallet.
  The puck and other mallets interpolate an 80 ms snapshot buffer; scores and
  events always come from the server. Snapshots are sent at 25 Hz.
- Joust input is sampled on the shared wall-clock timeline at 60 Hz and sent
  in 50 ms batches. Late inputs replay the deterministic simulation. Prediction
  is capped at six ticks ahead of received input. Only events whose inputs are
  known on both sides are shown. An online pass never slows its input clock for
  a cinematic. HTTP resolution remains the final score; failed trace uploads
  are retried. After reconnect the complete bounded trace is resent.
- Darts streams aim/launches and sends a change hint after the API commits a
  throw, prompting the opponent to fetch the authoritative state immediately.
  Polling remains the recovery path.

## Connections

`src/room/client.js` (in muppet-games) reconnects with exponential backoff and
resumes its stored identity. A replaced tab does not reconnect and fight for
control. An unexpectedly disconnected hockey player's seat is held for ten
seconds, with the match paused until all seats reconnect. Intentional departure
releases the seat. Restarting the server preserves identities and coins, but
live matches are ephemeral and players rejoin a fresh table.

`net/live.js` obtains a short-lived signed ticket from `/api/live`. The game
host checks it and fixes the sender's seat, game and room. It cannot be used to
join another channel or impersonate another seat. Each connection has a rate
ceiling and bounded outgoing buffering. Slow clients reconnect instead of
accumulating an indefinitely stale stream. The game host uses `/ws` for lobby
sessions and `/live` for darts/joust traffic.

The lobby UI shows measured ping and jitter. This is still a single-process
host: do not run several independent replicas behind a random load balancer.
Scaling beyond one host requires routing each room consistently to one owner
and replacing the local coin ledger with shared durable storage.

## Run and deploy

From the repository root:

```sh
npm ci
npm --prefix games/muppet-games ci
npm run dev:games                     # Muppet Vite + room server
npm run dev                          # Next, port 3000
```

For Darts/Joust live play, set these server-side variables:

| Variable | Where | Meaning |
|---|---|---|
| `GAME_LIVE_SECRET` | Next + game host | Same random secret, at least 32 characters; never a browser variable |
| `GAME_LIVE_URL` | Next | Public WSS endpoint, e.g. `wss://games.example.com/live` |
| `GAME_ALLOWED_ORIGINS` | Game host | Comma-separated exact web origins allowed to connect, including the Next deployment |
| `PUB_LEDGER` | Game host | Durable private ledger path |
| `HOST`, `PORT` | Game host | Bind address and port |

Existing `TTT_DATABASE_URL`, player tokens and other Next settings remain.
Apply all migrations, including `0004_joust_pass_riders.sql`, before deploying
the integrated jousting branch. Missing live configuration produces a visible
connection failure for jousting; it never silently uses unrelated credentials.
Darts can still fall back to polling.

A container recipe is at `games/muppet-games/Dockerfile`. Build from the repo
root: `docker build -f games/muppet-games/Dockerfile -t muppet-games .`.
Run one persistent instance, mount `/data`, terminate HTTPS/WSS at the hosting
proxy, and supply the variables above. Use `/health` for health checks.
The image serves the pub and all Muppet games as well as the live relay.
The Next app remains a separate deployment.

## Verification

`npm run test:network` runs the networking regressions. The air-hockey tests use
0–200 ms simulated RTT, variable delay, skipped snapshots, rematches and stalls.
The joust tests run 80 seeded passes with delayed, duplicated and dropped batches
and compare every confirmed event with the authoritative simulation.
The real WebSocket suite covers team seats, input acknowledgements, spectators,
match/lobby isolation, reconnects and ticket-bound relay identities.

For the real Postgres suites, start a throwaway cluster with
`npm run test:pg start`, then run:

```sh
export JOUST_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54371/joust_test
npm run test:joust
npm run test:sql
npm run test:pg stop
```

GitHub Actions runs these suites against an isolated Postgres service, builds
Next, and builds the game-host container on every pull request.
The legacy SQL suites report SKIPPED if that database is absent; a skipped suite
is not evidence that SQL works. These local tests do not establish WAN latency
or production capacity. Test geographically separated players before rollout.
