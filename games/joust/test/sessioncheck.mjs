import assert from 'node:assert/strict';
import { JoustSession } from '../src/net/online.js';

const originalFetch = globalThis.fetch;
const session = new JoustSession();
let armed = 0,
  resolved = 0,
  tracePosts = 0;
session.onPassArmed = () => armed++;
session.onPassResolved = () => resolved++;
try {
  session.active = true;
  session._absorb({ version: 4, match: { pass: 4 }, passes: [{ pass_no: 2, result: { score: [0, 0] } }] });
  session._absorb({ version: 5, match: { pass: 1 }, open: { pass_no: 0, seed: 99 } });
  assert.equal(session.lastPass, -1, 'a rematch resets the result cursor');
  assert.equal(armed, 1);
  session._absorb({ version: 4, match: { pass: 4 } });
  assert.equal(session.match.pass, 1, 'late HTTP replies cannot restore the old match');

  globalThis.fetch = async (url) => {
    if (url.includes('/trace')) {
      tracePosts++;
      if (tracePosts === 1) throw Error('Connection lost');
      return { json: async () => ({ ok: true, result: null }) };
    }
    return { json: async () => ({ ok: true, version: 5, match: { pass: 1 } }) };
  };
  await session.submitTrace(0, [[0, 0, 0, 0, 0]]);
  assert.ok(session._trace, 'a failed upload retains the immutable trace');
  await session.poll();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tracePosts, 2);
  assert.equal(session._trace, null);

  let reply;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      reply = resolve;
    });
  const outstanding = session.submitTrace(0, [[0, 0, 0, 0, 0]]);
  session.stop();
  const previous = resolved;
  reply({ json: async () => ({ ok: true, result: { score: [1, 0] }, match: { pass: 2 } }) });
  await outstanding;
  assert.equal(resolved, previous, 'a late trace response cannot revive a stopped game');
  assert.equal(session._trace, null);
  assert.equal(session.pending, 0);
  console.log('sessioncheck: rematch cursors, stale responses, trace retries and stop cancellation passed');
} finally {
  session.stop();
  globalThis.fetch = originalFetch;
}
