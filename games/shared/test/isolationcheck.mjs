import assert from 'node:assert/strict';
import pg from 'pg';
import { inMatch, matchRequest } from '../../../lib/match-context.mjs';
import * as D from '../../../lib/darts.mjs';
import * as J from '../../../lib/joust.mjs';
const connectionString = process.env.JOUST_TEST_DATABASE_URL;
if (!connectionString) throw Error('Set JOUST_TEST_DATABASE_URL to an isolated test database');
const pool = new pg.Pool({ connectionString, max: 6 });
D.__useQuery((s, p) => pool.query(s, p));
J.__useQuery((s, p) => pool.query(s, p));
try {
  const ids = Array.from({ length: 16 }, (_, i) => `isolation-${process.pid}-${i}`);
  await Promise.all(
    ids.map((id) =>
      inMatch(id, async () => {
        const [d, j] = await Promise.all([D.getMatch(), J.getMatch()]);
        assert.equal(d.id, id);
        assert.equal(j.id, id);
        await D.touchPresence(0, { name: id });
        await J.touchPresence(0, { name: id });
        assert.equal((await D.listPresence())[0].name, id);
        assert.equal((await J.listPresence())[0].name, id);
      }),
    ),
  );
  const req = new Request('http://localhost/api/darts/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: ids[0] }),
  });
  assert.equal(
    await (
      await matchRequest(req, async () => Response.json({ id: (await D.getMatch()).id }))
    )
      .json()
      .then((r) => r.id),
    ids[0],
  );
  assert.equal(
    (
      await matchRequest(new Request('http://localhost/api/darts/state?room=bad%20room'), () =>
        Response.json({}),
      )
    ).status,
    400,
  );
  console.log(
    'isolationcheck: 16 concurrent SQL matches retain independent state/presence; request boundaries validated',
  );
} finally {
  await pool.end();
}
