import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const gameDir = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'muppet-host-check-'));
const processes = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function availablePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
function start(args, env) {
  const child = spawn(process.execPath, ['scripts/host-games.mjs', ...args], {
    cwd: gameDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      GAME_LIVE_SECRET: '',
      PUB_LEDGER: path.join(temp, 'ledger.json'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  processes.push(child);
  return {
    child,
    exited,
    output: () => output,
    async waitFor(text) {
      const deadline = Date.now() + 7000;
      while (!output.includes(text) && child.exitCode === null && Date.now() < deadline) await sleep(20);
      assert.ok(output.includes(text), output);
    },
  };
}
try {
  const port = await availablePort();
  const host = start([], { PORT: String(port) });
  await host.waitFor('Friends on the same network:');
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(base + '/health')).json()).ok, true);
  assert.match(await (await fetch(base + '/pub.html')).text(), /Fuzz|Feather/);
  assert.equal((await fetch(base + '/server/data/ledger.json')).status, 404, 'ledger stays private');
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  const welcome = await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', create: true, name: 'Local host check' })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'welcome') resolve(m);
    });
  });
  assert.match(welcome.room, /^[A-Z2-9]{6}$/);
  ws.terminate();
  host.child.kill('SIGTERM');
  assert.equal(await host.exited, 0);

  // A fake executable tests tunnel supervision without publishing anything.
  const fake = path.join(temp, 'fake-cloudflared');
  await writeFile(
    fake,
    `#!${process.execPath}\nconsole.log('https://isolated-test.trycloudflare.com');setTimeout(()=>process.exit(7),1200);\n`,
    { mode: 0o700 },
  );
  const remotePort = await availablePort();
  const remote = start(['--no-build', '--internet'], {
    PORT: String(remotePort),
    CLOUDFLARED: fake,
  });
  await remote.waitFor('Share with friends: https://isolated-test.trycloudflare.com/pub.html');
  const forwarded = new WebSocket(`ws://127.0.0.1:${remotePort}/ws`, {
    headers: { Origin: 'https://isolated-test.trycloudflare.com' },
  });
  await new Promise((resolve, reject) => {
    forwarded.once('open', resolve);
    forwarded.once('error', reject);
  });
  forwarded.terminate();
  assert.equal(await remote.exited, 1, 'a dead tunnel must stop hosting and report failure');
  assert.match(remote.output(), /internet tunnel stopped/);
  const invalid = start(['--no-build'], { PORT: '-1' });
  assert.equal(await invalid.exited, 1);
  assert.match(invalid.output(), /PORT must/);
  console.log(
    'hostcheck: local HTTP/WebSocket play, private ledger, shutdown, tunnel supervision and configuration passed',
  );
} finally {
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
  await rm(temp, { recursive: true, force: true });
}
