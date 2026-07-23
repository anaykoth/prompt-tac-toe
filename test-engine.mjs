import assert from "node:assert";
import { applyMove, finalizeByBoards, newGame } from "./lib/engine.mjs";

const t = "2026-01-01T00:00:00Z";
const give = (st, p, n = 1) => (st.credits[p] += n);

// Credits gate moves entirely.
{
  const st = newGame("X");
  assert.equal(applyMove(st, "X", 4, 4, t).error, "no-credits");
  give(st, "X");
  assert.ok(applyMove(st, "X", 4, 4, t).ok);
  assert.equal(st.credits.X, 0);
}

// Turn order + the "sent board" constraint.
{
  const st = newGame("X");
  give(st, "X", 5);
  give(st, "O", 5);
  assert.equal(applyMove(st, "O", 4, 4, t).error, "not-your-turn");
  assert.ok(applyMove(st, "X", 4, 4, t).ok); // cell 4 sends O to board 4
  assert.equal(st.nextBoard, 4);
  assert.equal(applyMove(st, "O", 3, 0, t).error, "wrong-board");
  assert.ok(applyMove(st, "O", 4, 0, t).ok); // sends X to board 0
  assert.ok(applyMove(st, "X", 0, 4, t).ok); // sends O back to board 4
  assert.equal(applyMove(st, "O", 4, 4, t).error, "cell-taken");
  assert.ok(applyMove(st, "O", 4, 1, t).ok);
}

// Small-board win claims it; a cell pointing at a closed board = play anywhere.
{
  const st = newGame("X");
  st.credits = { X: 99, O: 99 };
  const seq = [
    ["X", 0, 0], ["O", 0, 3], ["X", 3, 0], ["O", 0, 4], ["X", 4, 0], ["O", 0, 5], // O takes board 0 (cells 3,4,5)
  ];
  for (const [p, b, c] of seq) {
    const r = applyMove(st, p, b, c, t);
    assert.ok(r.ok, `${p} ${b},${c}: ${r.error}`);
  }
  assert.equal(st.boardWinners[0], "O");
  assert.equal(st.nextBoard, 5); // O's winning move was cell 5
  assert.equal(applyMove(st, "X", 0, 1, t).error, "board-closed");
  assert.ok(applyMove(st, "X", 5, 0, t).ok); // cell 0 points at won board 0
  assert.equal(st.nextBoard, null); // -> O may play anywhere open
}

// Big win via three claimed boards in a row.
{
  const st = newGame("X");
  st.credits = { X: 99, O: 99 };
  // Hand-craft: X owns boards 0 and 1; then wins board 2.
  st.boardWinners[0] = "X";
  st.boardWinners[1] = "X";
  st.cells[2][0] = "X";
  st.cells[2][1] = "X";
  st.nextBoard = 2;
  const r = applyMove(st, "X", 2, 2, t);
  assert.ok(r.ok, r.error);
  assert.equal(st.winner, "X");
}

// Finalize by boards: more claimed small boards takes the day.
{
  const st = newGame("X");
  st.boardWinners = ["X", "O", "X", null, "D", null, null, null, null];
  const res = finalizeByBoards(st);
  assert.equal(res.winner, "X");
  assert.equal(res.reason, "boards");
  assert.equal(res.xBoards, 2);
  assert.equal(res.oBoards, 1);
}

// Finalize a dead-even day = draw.
{
  const st = newGame("X");
  st.boardWinners = ["X", "O", null, null, null, null, null, null, null];
  const res = finalizeByBoards(st);
  assert.equal(res.winner, "D");
  assert.equal(res.reason, "draw");
}

console.log("engine tests passed");
