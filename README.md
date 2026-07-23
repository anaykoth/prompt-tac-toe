# Prompt-Tac-Toe

Daily ultimate tic-tac-toe where moves are earned by making Claude Code
prompts. One game per day; every real prompt banks a move credit (capped so a
backlog can't turn into a marathon session).

## How it works

- Each player's Claude Code has a `UserPromptSubmit` hook that pings the game
  API with their player token on every prompt, banking one move credit
  (default cap: 3 banked at a time).
- Turns strictly alternate. On your turn you spend one credit to place a move
  on the board web page. No credits = you have to go prompt Claude.
- Standard ultimate tic-tac-toe rules: the cell you pick sends your opponent
  to that small board; win three small boards in a row to win. If you're sent
  to a decided board, you play anywhere.
- A new game starts each day (America/New_York). If nobody has won by
  midnight, whoever holds more small boards takes the day; ties are draws.
  Yesterday's loser starts today's game. Daily results accumulate a tally.

## Pieces

| Piece | Where |
| --- | --- |
| Game API + rules engine | Supabase Edge Function `prompt-tac-toe` on the diyona-crm project (`iibtglstfscurtiqpeuc`), source in `supabase/functions/prompt-tac-toe/` |
| State | `ttt_games` + `ttt_results` tables, same project (RLS-locked; service role only) |
| Board UI | `ui/index.html`, deployed to GitHub Pages: https://anaykoth.github.io/prompt-tac-toe/ (public repo `anaykoth/prompt-tac-toe` holds only this page) |
| Prompt hook | `install-hook.sh` adds the `UserPromptSubmit` hook to `~/.claude/settings.json` |

The API base URL is
`https://iibtglstfscurtiqpeuc.supabase.co/functions/v1/prompt-tac-toe`
(GET on it redirects to the board). Endpoints: `POST /api/prompt` (hook),
`GET /api/state`, `POST /api/move` — all token-gated for anything that
identifies or mutates.

## Player setup

1. Open your player link once (saves your token in the browser):
   `https://anaykoth.github.io/prompt-tac-toe/?t=<your-token>`
2. Run `./install-hook.sh <your-token>` (needs `python3` + `curl`), then
   restart open Claude Code sessions.

Player tokens live in the deployed function config (`config.ts` has the
defaults; function secrets `TTT_TOKEN_X` / `TTT_TOKEN_O` / `TTT_NAME_O` /
`TTT_CREDIT_CAP` override without a code change). Tokens only gate this game —
worst case someone plays a move as you.

## Dev notes

- `npm test` runs the pure rules-engine tests (`test-engine.mjs`) — no deps.
- Redeploy the function via the Supabase MCP `deploy_edge_function` (or
  `supabase functions deploy prompt-tac-toe --no-verify-jwt`).
- The UI deploys by pushing `ui/index.html` to the `anaykoth/prompt-tac-toe`
  GitHub repo (Pages serves from main).
- Supabase's gateway rewrites any HTML response from functions/storage to
  `text/plain` + sandbox CSP — that's why the UI lives on GitHub Pages.
