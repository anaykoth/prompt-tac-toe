// Ultimate tic-tac-toe rules, pure functions over a plain state object.
//
// State shape:
//   cells:        9 boards x 9 cells, "X" | "O" | null
//   boardWinners: per small board, "X" | "O" | "D" (drawn/full) | null
//   nextBoard:    0-8 board the current player MUST play in, or null = any open
//   turn:         "X" | "O"
//   credits:      banked moves per player (earned by Claude prompts)
//   prompts:      total prompts counted today per player (stat only)
//   moves:        history [{p, b, c, t}]
//   winner:       "X" | "O" | "D" | null

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function lineWinner(a) {
  for (const [i, j, k] of LINES) {
    if (a[i] && a[i] !== "D" && a[i] === a[j] && a[j] === a[k]) return a[i];
  }
  return null;
}

export function newGame(starter) {
  return {
    cells: Array.from({ length: 9 }, () => Array(9).fill(null)),
    boardWinners: Array(9).fill(null),
    nextBoard: null,
    turn: starter,
    credits: { X: 0, O: 0 },
    prompts: { X: 0, O: 0 },
    moves: [],
    winner: null,
    finishedAt: null,
  };
}

export function playableBoards(st) {
  if (st.winner) return [];
  if (st.nextBoard !== null) return [st.nextBoard];
  return [...Array(9).keys()].filter((i) => !st.boardWinners[i]);
}

export function boardCounts(st) {
  let x = 0, o = 0;
  for (const w of st.boardWinners) {
    if (w === "X") x++;
    else if (w === "O") o++;
  }
  return { x, o };
}

// Mutates st in place. Returns {ok:true} or {ok:false, error}.
export function applyMove(st, p, b, c, nowIso) {
  if (st.winner) return { ok: false, error: "game-finished" };
  if (st.turn !== p) return { ok: false, error: "not-your-turn" };
  if ((st.credits[p] ?? 0) < 1) return { ok: false, error: "no-credits" };
  if (!Number.isInteger(b) || b < 0 || b > 8 || !Number.isInteger(c) || c < 0 || c > 8) {
    return { ok: false, error: "bad-input" };
  }
  if (st.boardWinners[b]) return { ok: false, error: "board-closed" };
  if (st.nextBoard !== null && st.nextBoard !== b) return { ok: false, error: "wrong-board" };
  if (st.cells[b][c]) return { ok: false, error: "cell-taken" };

  st.cells[b][c] = p;
  st.credits[p] -= 1;
  st.moves.push({ p, b, c, t: nowIso });

  const bw = lineWinner(st.cells[b]);
  if (bw) st.boardWinners[b] = bw;
  else if (st.cells[b].every(Boolean)) st.boardWinners[b] = "D";

  const big = lineWinner(st.boardWinners);
  if (big) {
    st.winner = big;
    st.finishedAt = nowIso;
  } else if (st.boardWinners.every(Boolean)) {
    const { x, o } = boardCounts(st);
    st.winner = x > o ? "X" : o > x ? "O" : "D";
    st.finishedAt = nowIso;
  }

  st.nextBoard = st.boardWinners[c] ? null : c;
  st.turn = p === "X" ? "O" : "X";
  return { ok: true };
}

// End-of-day (or all-boards-closed) result: most claimed small boards wins.
export function finalizeByBoards(st) {
  const { x, o } = boardCounts(st);
  const bigLine = lineWinner(st.boardWinners);
  const winner = st.winner ?? (x > o ? "X" : o > x ? "O" : "D");
  const reason = bigLine && bigLine === winner ? "win" : winner === "D" ? "draw" : "boards";
  return { winner, xBoards: x, oBoards: o, reason };
}
