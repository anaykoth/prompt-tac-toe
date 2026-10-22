# The shared pub

A small authoritative Node server owns private room codes, player identities,
fictional pub coins, rock–paper–scissors stakes, and air hockey. No real money.

Development: run `npm run server` and `npm run dev`. Open the Vite URL at
`/pub.html`. Vite proxies `/ws` and `/health` to port 8787.

One host: run `npm run build`, then `npm run server`, and open
`http://127.0.0.1:8787/pub.html`. The same process serves `dist/` and WebSockets.
For LAN play, run `HOST=0.0.0.0 npm run server`; friends use that computer's LAN
address and the host's room code. `PORT` defaults to 8787. This is a prototype
for a trusted group; internet deployment also needs TLS and process management.

Players start with 250 coins per room; each of the four NPCs has 1,000. Coins
are independent from the older single-player Pool Lab wallet. RPS reserves
both stakes before choice, keeps locked choices private, and pays exactly once.
A draw, timeout, disconnect, or server shutdown refunds both stakes. On restart,
any interrupted reservations are refunded. NPCs choose before any human input.

The atomic JSON ledger is `server/data/ledger.json` (or `PUB_LEDGER`). Keep it
private: it contains hashes of room resume tokens and all balances. The browser
stores its secret resume token per room. Opening the same identity in another
tab takes over its connection; use a separate browser/profile for two players.
The file is intended for a single server process, not several concurrent hosts.

`src/room/client.js` exports `RoomClient`. Subscribe with `on(fn)`, call
`connect({create:true,name})` or `connect({room,name})`, then `send(type,payload)`.
`id`, `room`, `connected`, `state`, and `hockey` expose current connection state.
The client deliberately does not silently reconnect while another tab owns the
identity. Rejoining explicitly resumes the saved identity and balance.

Wire messages use `{type, ...payload}`:

- `hello {create,room,name,token}` → `welcome {id,room,token,state}`.
- `move {x,y,yaw}` and `name {name}` update presence. Room bounds are ±7 by ±4.5.
- `state {room,players,npcs,challenges,rounds,results}` contains public state.
- `rps.challenge {targetId,stake}` → challenge (human accept required) or round
  (NPC auto accepts). Stand within 2.3 units. Stakes are whole numbers 1–1,000.
- `rps.accept {challengeId}` / `rps.decline {challengeId}`.
- `rps.round {id,participants,stake,deadline,locked}` exposes lock flags only.
- `rps.choose {roundId,choice}` with rock/paper/scissors; choice cannot change.
- `rps.result {roundId,participantIds,choices,winnerId,stake,payout,reason}`.
- `hockey.join {seat:0|1}`, `hockey.leave {}`, `hockey.input {x,y}`.
- `hockey.restart {}` requires both seated players to request a reset.
- `hockey.state {seats,state,tick,playing,restartVotes}` broadcasts at 25 Hz.
  Server physics steps at 120 Hz; shared simulation further substeps contacts.
  Seats 0/1 correspond to positive/negative y. Two players start a fresh game.
- `error {code,message}` explains an invalid action without changing balances.

Tests: `node test/roomcheck.mjs` starts an isolated ephemeral-port server with a
temporary ledger, connects actual WebSocket clients, and checks private choices,
reservation/payout idempotence, invalid inputs, disconnect recovery, resume,
server restart recovery, and the authoritative hockey seats.
