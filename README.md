# Prompt-Tac-Toe

Daily ultimate tic-tac-toe where moves are earned by making Claude Code
prompts. One game per day; every real prompt banks a move credit (capped so a
backlog can't turn into a marathon session).

Live at **https://prompt-tac-toe.vercel.app**

## How it works

- Each player's Claude Code has a `UserPromptSubmit` hook that pings
  `POST /api/prompt` with their player token on every prompt, banking one move
  credit (default cap: 3 banked at a time).
- Turns strictly alternate. On your turn you spend one credit to place a move
  on the board. No credits = you have to go prompt Claude.
- Standard ultimate tic-tac-toe rules: the cell you pick sends your opponent
  to that small board; win three small boards in a row to win. If you're sent
  to a decided board, you play anywhere.
- A new game starts each day (America/New_York). If nobody has won by
  midnight, whoever holds more small boards takes the day; ties are draws.
  Yesterday's loser starts. Daily results accumulate a tally.

## Stack

Single Next.js app (board page + `/api/prompt`, `/api/state`, `/api/move`
route handlers) deployed on Vercel via the GitHub integration — every push to
`main` auto-deploys. State lives in a dedicated Supabase Postgres (free tier),
reached through the Supavisor pooler (the direct `db.*` host is IPv6-only,
which Vercel cannot reach). The pure rules engine is `lib/engine.mjs`.

All secrets are Vercel env vars (none in this repo):

| Var | Meaning |
| --- | --- |
| `TTT_DATABASE_URL` | Supabase pooler connection string |
| `TTT_TOKEN_X` / `TTT_TOKEN_O` | Player tokens (gate who plays as X / O) |
| `TTT_NAME_X` / `TTT_NAME_O` | Display names |
| `TTT_CREDIT_CAP` | Optional, default 3 |

## Player setup

1. Open your player link once (saves your token in the browser):
   `https://prompt-tac-toe.vercel.app/?t=<your-token>`
2. Run `./install-hook.sh <your-token>` (needs `python3` + `curl`), then
   restart open Claude Code sessions.

## Dev

- `npm test` — rules-engine tests (plain node, no DB needed).
- `npm run dev` — local dev server; copy `.env.local` values from Vercel.
- `npm run migrate` — applies `supabase/migrations/0001_ttt_tables.sql`.
