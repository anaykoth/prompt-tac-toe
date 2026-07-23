"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ERRORS = {
  "no-credits": "No banked moves - prompt Claude first.",
  "not-your-turn": "Not your turn.",
  "wrong-board": "You have to play in the highlighted board.",
  "cell-taken": "That spot is taken.",
  "board-closed": "That board is already decided.",
  "game-finished": "Today's game is over.",
  "bad-token": "This link has no valid player token.",
  conflict: "Board changed under you - try again.",
};

export default function Home() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const [flash, setFlash] = useState(null);
  const [offline, setOffline] = useState(false);
  const tokenRef = useRef(null);
  const flashTimer = useRef(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("t");
    if (t) {
      localStorage.setItem("ttt-token", t);
      url.searchParams.delete("t");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    tokenRef.current = localStorage.getItem("ttt-token");
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const q = tokenRef.current ? `?token=${encodeURIComponent(tokenRef.current)}` : "";
      const r = await fetch(`/api/state${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`state ${r.status}`);
      setData(await r.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    refresh();
    const id = setInterval(refresh, 4000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [ready, refresh]);

  const showFlash = (msg) => {
    clearTimeout(flashTimer.current);
    setFlash(msg);
    flashTimer.current = setTimeout(() => setFlash(null), 3500);
  };

  const play = async (b, c) => {
    try {
      const r = await fetch("/api/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, board: b, cell: c }),
      });
      const json = await r.json();
      if (json.ok) {
        setData((prev) => (prev ? { ...prev, game: json.game } : prev));
        refresh();
      } else {
        showFlash(ERRORS[json.error] ?? json.error);
        refresh();
      }
    } catch {
      showFlash("Network error - move not placed.");
    }
  };

  if (!ready || !data) {
    return (
      <main className="wrap">
        <h1 className="title">Prompt-Tac-Toe</h1>
        <p className="muted">Loading today's board…</p>
      </main>
    );
  }

  const { you, names, creditCap, game: st, results, tally, date } = data;
  const other = you === "X" ? "O" : "X";
  const myTurn = !!you && st.turn === you && !st.winner;
  const myCredits = you ? st.credits[you] ?? 0 : 0;
  const canPlay = myTurn && myCredits > 0;
  const playable = new Set(
    st.winner
      ? []
      : st.nextBoard !== null
        ? [st.nextBoard]
        : [...Array(9).keys()].filter((i) => !st.boardWinners[i])
  );

  let status;
  let statusTone = "info";
  if (st.winner === "D") {
    status = "Today ended in a draw.";
    statusTone = "done";
  } else if (st.winner) {
    status = `${names[st.winner]} takes today's board.`;
    statusTone = "done";
  } else if (!you) {
    status = "Spectator view - open your player link to make moves.";
  } else if (myTurn && myCredits > 0) {
    status =
      st.nextBoard !== null
        ? "Your move - play in the highlighted board."
        : "Your move - any open board.";
    statusTone = "go";
  } else if (myTurn) {
    status = "Your turn, but nothing banked. Prompt Claude to earn a move.";
    statusTone = "wait";
  } else {
    status =
      (st.credits[other] ?? 0) > 0
        ? `Waiting on ${names[other]} to place their move.`
        : `Waiting on ${names[other]} to prompt Claude.`;
  }

  const creditDots = (sym) => {
    const n = st.credits[sym] ?? 0;
    return [...Array(creditCap).keys()].map((i) => (
      <span key={i} className={`dot ${i < n ? `full ${sym.toLowerCase()}` : ""}`} />
    ));
  };

  return (
    <main className="wrap">
      <header className="top">
        <h1 className="title">Prompt-Tac-Toe</h1>
        <span className="muted">{date}</span>
      </header>

      <div className="scoreboard">
        <span className="pname x">{names.X}</span>
        <span className="score">
          {tally.X} · {tally.D} · {tally.O}
        </span>
        <span className="pname o">{names.O}</span>
      </div>

      <p className={`status ${statusTone}`}>{status}</p>
      {flash && <p className="flash">{flash}</p>}
      {offline && <p className="flash">Connection hiccup - retrying…</p>}

      <div className="big">
        {st.cells.map((board, b) => {
          const w = st.boardWinners[b];
          const active = playable.has(b) && myTurn;
          return (
            <div key={b} className={`sub${active ? " active" : ""}`}>
              {board.map((cell, c) => {
                const clickable = canPlay && playable.has(b) && !cell && !w;
                return (
                  <button
                    key={c}
                    className={`cell${clickable ? " playable" : ""}`}
                    onClick={() => clickable && play(b, c)}
                    disabled={!clickable}
                  >
                    {cell && <span className={`glyph ${cell.toLowerCase()}`}>{cell}</span>}
                  </button>
                );
              })}
              {w && (
                <div className={`overlay ${w.toLowerCase()}`}>
                  {w === "D" ? "–" : w}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="credits">
        <div className="creditbox">
          <span className="pname x">{names.X}</span>
          <span className="dots">{creditDots("X")}</span>
        </div>
        <span className="muted small">banked moves</span>
        <div className="creditbox">
          <span className="dots">{creditDots("O")}</span>
          <span className="pname o">{names.O}</span>
        </div>
      </div>

      <p className="muted small center">
        Prompts today - {names.X}: {st.prompts.X ?? 0} · {names.O}: {st.prompts.O ?? 0}
      </p>

      {results.length > 0 && (
        <section className="history">
          <h2>Past days</h2>
          {results.map((r) => (
            <div key={r.date} className="hrow">
              <span className="muted">{r.date}</span>
              <span className={r.winner === "D" ? "" : `pname ${r.winner.toLowerCase()}`}>
                {r.winner === "D" ? "Draw" : names[r.winner]}
              </span>
              <span className="muted">
                {r.x_boards}–{r.o_boards}
                {r.reason === "win" ? " (line win)" : r.reason === "boards" ? " (on boards)" : ""}
              </span>
            </div>
          ))}
        </section>
      )}

      <footer className="muted small">
        Every Claude prompt banks a move (max {creditCap}). Your move's cell decides
        which board your opponent plays next. Win three small boards in a row - or
        hold more boards at midnight ET.
      </footer>
    </main>
  );
}
