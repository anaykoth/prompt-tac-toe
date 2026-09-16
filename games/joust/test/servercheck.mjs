/**
 * The rules lib/joust.mjs enforces, exercised without a database.
 *
 * A fake in-process query function stands in for Postgres (same SQL the real
 * routes issue, matched by shape), so join / ready / trace / resolve are run
 * for real rather than only reviewed. Mirrors games/darts/test/servercheck.mjs.
 *
 * `node test/servercheck.mjs`
 */
import * as J from '../../../lib/joust.mjs';
import { packInput, F_COUCH, PASS_MAX_S, TICK } from '../src/game/spec.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };

/* ------------------------------------------------ the fake database ------ */

function makeDb() {
  const db = { matches: new Map(), passes: new Map(), presence: new Map() };
  const key = (m, n) => `${m}|${n}`;
  const online = (row) => Date.now() - row.seen_at < 25_000;

  const q = async (sql, args = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const rows = [];

    if (/^select id, state, version, finished from public\.joust_matches/.test(s)) {
      const m = db.matches.get(args[0]);
      if (m) rows.push({ ...m });
      return { rows, rowCount: rows.length };
    }
    if (/^insert into public\.joust_matches/.test(s)) {
      if (!db.matches.has(args[0])) db.matches.set(args[0], { id: args[0], state: args[1], version: 0, finished: false });
      return { rows, rowCount: 1 };
    }
    if (/^update public\.joust_matches set state/.test(s)) {
      const m = db.matches.get(args[2]);
      if (!m || m.version !== args[3]) return { rows, rowCount: 0 };
      Object.assign(m, { state: args[0], finished: args[1], version: m.version + 1 });
      return { rows, rowCount: 1 };
    }
    if (/^delete from public\.joust_passes/.test(s)) {
      for (const k of [...db.passes.keys()]) if (k.startsWith(`${args[0]}|`)) db.passes.delete(k);
      return { rows, rowCount: 1 };
    }
    if (/^update public\.joust_presence set ready = false/.test(s)) {
      for (const p of db.presence.values()) if (p.match_id === args[0]) p.ready = false;
      return { rows, rowCount: 1 };
    }
    if (/^select pass_no, seed, .* from public\.joust_passes where match_id = \$1 and pass_no > \$2/.test(s)) {
      for (const p of db.passes.values()) {
        if (p.match_id === args[0] && p.pass_no > args[1]) {
          rows.push({ pass_no: p.pass_no, seed: p.seed, starts_at: p.starts_at, traces: p.traces, result: p.result, resolved_at: p.resolved_at });
        }
      }
      rows.sort((a, b) => a.pass_no - b.pass_no);
      return { rows, rowCount: rows.length };
    }
    if (/^select seat, name, spec, drunk, ready/.test(s)) {
      for (const p of db.presence.values()) if (p.match_id === args[0]) rows.push({ ...p, online: online(p) });
      rows.sort((a, b) => a.seat - b.seat);
      return { rows, rowCount: rows.length };
    }
    if (/^insert into public\.joust_presence/.test(s)) {
      const [m, seat, name, spec, drunk, ready] = args;
      const k = key(m, seat);
      const cur = db.presence.get(k);
      if (!cur) db.presence.set(k, { match_id: m, seat, name: name ?? '', spec, drunk, ready: ready ?? false, seen_at: Date.now() });
      else Object.assign(cur, {
        name: name || cur.name, spec: spec ?? cur.spec, drunk,
        ready: typeof ready === 'boolean' ? ready : cur.ready, seen_at: Date.now(),
      });
      return { rows, rowCount: 1 };
    }
    if (/from public\.joust_passes where match_id = \$1 and result is null/.test(s)) {
      const open = [...db.passes.values()].filter((p) => p.match_id === args[0] && !p.result).sort((a, b) => b.pass_no - a.pass_no)[0];
      if (open) rows.push({ pass_no: open.pass_no, seed: open.seed, starts_at: open.starts_at, traces: open.traces, result: open.result });
      return { rows, rowCount: rows.length };
    }
    if (/^insert into public\.joust_passes/.test(s)) {
      const [m, passNo, seed, countdown] = args;
      const k = key(m, passNo);
      if (!db.passes.has(k)) {
        db.passes.set(k, { match_id: m, pass_no: passNo, seed, starts_at: Date.now() + countdown, traces: {}, result: null, resolved_at: null });
      }
      return { rows, rowCount: 1 };
    }
    if (/^select seed, .* from public\.joust_passes where match_id = \$1 and pass_no = \$2/.test(s)) {
      const p = db.passes.get(key(args[0], args[1]));
      if (p) rows.push({ seed: p.seed, starts_at: p.starts_at, traces: p.traces, result: p.result });
      return { rows, rowCount: rows.length };
    }
    if (/^update public\.joust_passes set traces = \$1, result = \$2/.test(s)) {
      const p = db.passes.get(key(args[2], args[3]));
      if (p) Object.assign(p, { traces: args[0], result: args[1], resolved_at: Date.now() });
      return { rows, rowCount: p ? 1 : 0 };
    }
    if (/^update public\.joust_passes set traces = \$1/.test(s)) {
      const p = db.passes.get(key(args[1], args[2]));
      if (p) p.traces = args[0];
      return { rows, rowCount: p ? 1 : 0 };
    }
    throw new Error(`fake db: unhandled SQL: ${s.slice(0, 90)}`);
  };
  return { db, q };
}

/* ------------------------------------------------------- input traces ---- */

const MAX_TICKS = Math.ceil(PASS_MAX_S / TICK);

/** Couch from tick 90 and hold the lance straight: the aggressive rider. */
function chargeTrace(n = 300, aimX = 0) {
  const out = [];
  for (let i = 0; i < n && i < MAX_TICKS; i++) {
    out.push(packInput({ leanX: 0, leanY: 0.2, aimX, aimY: 0, couch: i >= 90, guard: false, spur: i >= 60, fling: false }));
  }
  return out;
}
const idleTrace = (n = 200) => Array.from({ length: n }, () => [0, 0, 0, 0, 0]);

/* ------------------------------------------------------------ the suite -- */

let simulatePass = null;
let STUBBED = false;
try {
  ({ simulatePass } = await import('../src/game/pass.js'));
} catch {
  STUBBED = true;
  J.setResolver((a, b, seed) => ({
    hits: [{ seat: 0, zone: 'shield', points: (seed % 3) + 1 }, { seat: 1, zone: 'glance', points: a.length > b.length ? 2 : 1 }],
    unhorsed: null,
  }));
  console.log('  note: games/joust/src/game/pass.js is not present — resolver stubbed');
}

const fresh = () => { const { db, q } = makeDb(); J.__useQuery(q); return db; };

console.log('--- seats and the match row ---');
{
  fresh();
  const g = await J.getMatch();
  ok('a match appears on first touch', g?.id === J.MATCH_ID && g.version === 0);
  ok('it starts level', JSON.stringify(g.state.score) === '[0,0]' && g.state.passes === 0);
  await J.touchPresence(0, { name: 'Anay', spec: { mask: 'goat' }, drunk: 0.2 });
  await J.touchPresence(1, { name: 'Jake', spec: { mask: 'frog' }, drunk: 0.4 });
  const seats = await J.listPresence();
  ok('both seats are in the list', seats.length === 2 && seats[0].seat === 0 && seats[1].seat === 1);
  ok('and both read as online', seats.every((s) => s.online));
  ok('a heartbeat keeps the name and mask', (await (async () => {
    await J.touchPresence(0, { drunk: 0.9 });
    const s = (await J.listPresence())[0];
    return s.name === 'Anay' && s.spec?.mask === 'goat' && Math.abs(s.drunk - 0.9) < 1e-6;
  })()));
}

console.log('\n--- ready arms exactly one pass ---');
{
  fresh();
  await J.getMatch();
  await J.touchPresence(0, { name: 'Anay', drunk: 0 });
  await J.touchPresence(1, { name: 'Jake', drunk: 0 });
  const first = await J.markReady(0);
  ok('one seat ready arms nothing', first.ok && first.pass === null);
  const second = await J.markReady(1);
  ok('both ready arms the pass', second.ok && second.armed === true && second.pass);
  ok('with a seed', Number.isInteger(second.pass.seed) && second.pass.seed > 0);
  ok('and a start time in the future', second.pass.starts_at > Date.now(), String(second.pass.starts_at - Date.now()));
  ok('pass numbering starts at 0', second.pass.pass_no === 0);
  const again = await J.markReady(0);
  ok('readying again returns the same open pass', again.pass.pass_no === 0 && again.armed === false);
  ok('listPasses sees it', (await J.listPasses(-1)).length === 1);
}

console.log('\n--- one trace waits, both resolve ---');
let resolvedResult = null, resolvedSeed = null, traces = null;
{
  fresh();
  await J.getMatch();
  await J.touchPresence(0, { name: 'Anay', drunk: 0 });
  await J.touchPresence(1, { name: 'Jake', drunk: 0 });
  await J.markReady(0);
  const armed = (await J.markReady(1)).pass;
  resolvedSeed = armed.seed;

  traces = [chargeTrace(280, 0), chargeTrace(280, 0.1)];
  const a = await J.submitTrace(0, armed.pass_no, traces[0]);
  ok('seat 0 alone does not resolve', a.ok && a.result === null && a.waiting === 1);
  ok('the match has not moved', (await J.getMatch()).state.passes === 0);

  const b = await J.submitTrace(1, armed.pass_no, traces[1]);
  ok('both traces resolve the pass', b.ok && !!b.result);
  ok('the pass count advances', b.match.passes === 1);
  resolvedResult = b.result;

  const stored = (await J.listPasses(-1))[0];
  ok('the result is stored on the pass row', !!stored.result && !!stored.resolved_at);
  ok('and both traces are kept', Array.isArray(stored.traces['0']) && Array.isArray(stored.traces['1']));
  ok('re-submitting returns the stored verdict',
    JSON.stringify((await J.submitTrace(0, armed.pass_no, traces[0])).result) === JSON.stringify(stored.result));
}

console.log('\n--- the verdict is the simulation, not the client ---');
{
  if (STUBBED) {
    console.log('  skip: pass.js absent, resolver stubbed');
  } else {
    const direct = simulatePass({ seed: resolvedSeed >>> 0, logs: [traces[0], traces[1]] });
    const points = [0, 0];
    for (const h of resolvedResult.hits ?? []) points[h.seat] += h.points;
    ok('server points equal a direct simulatePass',
      JSON.stringify(points) === JSON.stringify(direct.score), `${JSON.stringify(points)} vs ${JSON.stringify(direct.score)}`);
    ok('the scoreboard carries them', JSON.stringify(resolvedResult.score) === JSON.stringify(points),
      JSON.stringify(resolvedResult.score));
    ok('the wire trace cannot express a score', traces[0].every((t) => t.length === 5 && typeof t[4] === 'number'));
  }
}

console.log('\n--- traces are validated ---');
{
  ok('a packed 60 Hz log is accepted', J.validTrace(chargeTrace(120)));
  ok('a couch flag survives packing', chargeTrace(120)[100][4] & F_COUCH);
  ok('not an array', J.validTrace('nope') === false);
  ok('empty', J.validTrace([]) === false);
  ok('too long', J.validTrace(idleTrace(MAX_TICKS + 50)) === false);
  ok('wrong tick width', J.validTrace([[0, 0, 0]]) === false);
  ok('out of range', J.validTrace([[5, 0, 0, 0, 0]]) === false);
  ok('non-finite', J.validTrace([[Number.NaN, 0, 0, 0, 0]]) === false);
  ok('bad flags', J.validTrace([[0, 0, 0, 0, 99]]) === false);
  fresh();
  await J.getMatch();
  await J.touchPresence(0, { name: 'Anay', drunk: 0 });
  await J.touchPresence(1, { name: 'Jake', drunk: 0 });
  await J.markReady(0);
  const armed = (await J.markReady(1)).pass;
  const bad = await J.submitTrace(0, armed.pass_no, [[0, 0, 0, 0, 99]]);
  ok('the server rejects one', bad.ok === false && bad.error === 'bad-trace');
  ok('and nothing was stored', Object.keys((await J.listPasses(-1))[0].traces).length === 0);
  ok('an unknown pass is refused', (await J.submitTrace(0, 99, chargeTrace(60))).error === 'no-such-pass');
}

console.log('\n--- a match runs to its end ---');
{
  fresh();
  await J.getMatch();
  await J.touchPresence(0, { name: 'Anay', drunk: 0 });
  await J.touchPresence(1, { name: 'Jake', drunk: 0 });
  let rounds = 0, last = null;
  while (rounds < 24) {
    const g = await J.getMatch();
    if (g.finished) break;
    await J.markReady(0);
    const armed = (await J.markReady(1)).pass;
    if (!armed) break;
    rounds++;
    await J.submitTrace(0, armed.pass_no, chargeTrace(280, 0));
    last = await J.submitTrace(1, armed.pass_no, chargeTrace(280, -0.05));
  }
  const g = await J.getMatch();
  ok('passes accumulate', g.state.passes >= 1, `${g.state.passes} passes`);
  ok('one round is exactly one pass', g.state.passes === rounds, `${g.state.passes} passes in ${rounds} rounds`);
  ok('the match ends, by unhorsing or on points, or is still live and honest',
    g.finished ? (g.state.winner === 0 || g.state.winner === 1)
               : g.state.score.every((n) => n < g.state.target),
    `${JSON.stringify(g.state)}`);
  ok('scores are numbers', g.state.score.every((n) => Number.isFinite(n)), JSON.stringify(g.state.score));
  ok('every pass has a verdict', (await J.listPasses(-1)).every((p) => !!p.result));
  if (g.finished) ok('a winner is a real seat', g.state.winner === 0 || g.state.winner === 1);
  if (g.finished) ok('no more passes arm', (await J.markReady(0)).error === 'match-over');
  ok('reset wipes the list', (await (async () => {
    const r = await J.resetMatch();
    return r.state.passes === 0 && (await J.listPasses(-1)).length === 0 && !r.finished;
  })()));
  ok('last reply kept its shape', last === null || (last.ok && 'pass_no' in last));
}

console.log('\n--- state serialises for the wire ---');
{
  fresh();
  await J.getMatch();
  await J.touchPresence(0, { name: 'Anay', drunk: 0 });
  await J.touchPresence(1, { name: 'Jake', drunk: 0 });
  await J.markReady(0);
  const armed = (await J.markReady(1)).pass;
  await J.submitTrace(0, armed.pass_no, chargeTrace(200));
  await J.submitTrace(1, armed.pass_no, chargeTrace(200, 0.2));
  const g = await J.getMatch();
  const wire = JSON.parse(JSON.stringify({ match: g.state, open: await J.openPass(), passes: await J.listPasses(-1) }));
  ok('match state survives a round trip', JSON.stringify(wire.match) === JSON.stringify(g.state));
  ok('the open pass is closed out', wire.open === null);
  ok('a resolved pass carries seed, traces and result',
    Number.isInteger(wire.passes[0].seed) && !!wire.passes[0].result && !!wire.passes[0].traces);
  ok('the match payload stays small', JSON.stringify(wire.match).length < 400, `${JSON.stringify(wire.match).length} bytes`);
}

console.log(`\n${pass} passed, ${fail} failed${STUBBED ? '  (resolver stubbed: pass.js absent)' : ''}`);
process.exit(fail ? 1 : 0);
