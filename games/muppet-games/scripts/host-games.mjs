import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const gameDir = fileURLToPath(new URL('../', import.meta.url));
const flags = new Set(process.argv.slice(2));
if (flags.has('--help')) {
  console.log(`Host the games on this computer (Node 22.12+).

  npm run host:games                 Build and host for your Wi-Fi/LAN
  npm run host:games -- --internet    Build and share a temporary HTTPS link
  npm run host:games -- --no-build    Reuse an existing build

Internet mode requires cloudflared installed separately. It exposes only the
built game site and game sockets; no tunnel is started without --internet.
Optional settings: PORT (8787), HOST, PUB_LEDGER, CLOUDFLARED.
Relay settings are loaded from the repository's ignored .env.game-host file.
Keep this computer awake and this terminal open. Ctrl+C stops the session.`);
  process.exit(0);
}
for (const flag of flags) {
  if (!['--internet', '--no-build'].includes(flag)) {
    console.error(`Unknown option: ${flag}. Use --help.`);
    process.exit(1);
  }
}
const envFile = path.join(root, '.env.game-host');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a whole number between 1 and 65535.');
  process.exit(1);
}
const internet = flags.has('--internet');
const host = process.env.HOST || (internet ? '127.0.0.1' : '0.0.0.0');
const upstream = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host}:${port}`;
let server,
  child,
  tunnel,
  tunnelTimer,
  stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  clearTimeout(tunnelTimer);
  child?.kill('SIGTERM');
  tunnel?.kill('SIGTERM');
  await server?.close();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

try {
  if (!flags.has('--no-build')) {
    console.log('Building the games…');
    await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
        cwd: gameDir,
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(Error('Game build failed. Run npm --prefix games/muppet-games ci first.')),
      );
    });
    child = null;
  }
  if (!stopping) {
    if (!existsSync(path.join(gameDir, 'dist/pub.html')))
      throw Error('No built games found. Run without --no-build.');
    if (process.env.GAME_LIVE_SECRET && process.env.GAME_LIVE_SECRET.length < 32)
      throw Error('GAME_LIVE_SECRET must have at least 32 characters.');
    // Load the server after .env.game-host so relay configuration is available.
    const { createPubServer } = await import('../server/index.js');
    if (stopping) throw Error('Hosting stopped.');
    server = createPubServer({ host, port });
    await server.listen();
    if (stopping) throw Error('Hosting stopped.');
    console.log(`\nGames are running on this computer: ${upstream}/pub.html`);
    if (!internet) {
      const addresses =
        host === '0.0.0.0' || host === '::'
          ? [
              ...new Set(
                Object.values(networkInterfaces())
                  .flat()
                  .filter((n) => n && !n.internal && n.family === 'IPv4')
                  .map((n) => n.address),
              ),
            ]
          : [host.includes(':') ? `[${host}]` : host];
      for (const address of addresses)
        console.log(`Friends on the same network: http://${address}:${port}/pub.html`);
      console.log('Open a room and share its invite link. For other networks, restart with --internet.');
    }
    console.log('Keep this computer awake and the terminal open. Ctrl+C ends hosting.');
    console.log(
      process.env.GAME_LIVE_SECRET
        ? 'Darts/Joust relay enabled. Next must use the same secret and this host’s /live address.'
        : 'Pub and team hockey are ready. Darts/Joust relay needs the shared GAME_LIVE_SECRET (see games/shared/README.md).',
    );

    if (internet) {
      const bundled = path.join(gameDir, '.tools/cloudflared');
      const binary = process.env.CLOUDFLARED || (existsSync(bundled) ? bundled : 'cloudflared');
      tunnel = spawn(binary, ['tunnel', '--url', upstream, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buffer = '',
        announced = false;
      const output = (data) => {
        buffer = (buffer + data.toString()).slice(-16000);
        const publicUrl = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
        if (publicUrl && !announced && !stopping) {
          announced = true;
          // Allow the exact tunnel origin even if its proxy rewrites Host.
          process.env.GAME_ALLOWED_ORIGINS = [
            ...new Set([...(process.env.GAME_ALLOWED_ORIGINS || '').split(',').filter(Boolean), publicUrl]),
          ].join(',');
          clearTimeout(tunnelTimer);
          console.log(`\nShare with friends: ${publicUrl}/pub.html`);
          console.log('Host and guests should open that link before creating or joining a room.');
          console.log(`Darts/Joust GAME_LIVE_URL: ${publicUrl.replace('https:', 'wss:')}/live`);
          console.log('This temporary link ends when hosting stops; restarting gives a new link.');
        }
      };
      tunnel.stdout.on('data', output);
      tunnel.stderr.on('data', output);
      tunnel.on('error', (error) => {
        console.error(
          `Could not start cloudflared (${error.code || error.message}). Install it from https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/ or set CLOUDFLARED.`,
        );
        void stop(1);
      });
      tunnel.on('exit', (code) => {
        if (!stopping) {
          console.error(`The internet tunnel stopped (${code}). Restart hosting to get a new share link.`);
          void stop(1);
        }
      });
      tunnelTimer = setTimeout(() => {
        console.error(
          'No internet share link arrived within 45 seconds. Check cloudflared and the network, then retry.',
        );
        void stop(1);
      }, 45000);
    }
  }
} catch (error) {
  if (!stopping)
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is in use. Stop the other host or choose a different PORT.`
        : error.message,
    );
  await stop(stopping ? process.exitCode : 1);
}
