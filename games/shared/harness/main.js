import { JoustSession } from '../net/joust.js';
import { readToken } from '../net/live.js';

import { resolvePass } from './pass-stub.js';   // the same stand-in the server runs

const $ = (s) => document.querySelector(s);
window.__events = [];
const log = (kind, data = {}) => {
  const e = { kind, at: Date.now(), ...data };
  window.__events.push(e);
  $('#log').textContent += `${new Date(e.at).toISOString().slice(11, 23)} ${kind} ${JSON.stringify(data)}\n`;
};
const paint = () => {
  $('#seat').textContent = net.seat ?? '?';
  $('#phase').textContent = net.phase;
  $('#score').textContent = net.match ? net.match.score.join(' - ') : '-';
  $('#off').textContent = Math.round(net.clock.offset);
};

const net = new JoustSession({
  token: readToken(),
  resolvePass,
  input: () => ({ yaw: 0, pitch: 0, lean: Number($('#lean').value), sway: 0 }),
  on: {
    state: () => paint(),
    presence: (s) => log('presence', { seats: [...s] }),
    armed: (p) => { log('armed', { passNo: p.pass_no, seed: p.seed, startsAt: p.starts_at, countdown: net.clock.until(p.starts_at) }); paint(); },
    charge: (p) => { log('charge', { passNo: p.pass_no }); paint(); },
    rider: (r) => { window.__riders = (window.__riders ?? 0) + 1; },
    contact: (p) => { log('contact', { passNo: p.pass_no, samples: net.trace.length }); paint(); },
    result: (r, m) => { log('result', { passNo: r.passNo, hits: r.hits, unhorsed: r.unhorsed, score: r.score ?? null, source: m.source, corrected: m.corrected }); paint(); },
    over: (m) => log('over', { winner: m.winner }),
    error: (e) => log('error', { e }),
  },
});
window.net = net;
$('#ready').onclick = () => { log('ready-click'); net.ready(); };
net.join({ name: 'HARNESS' }).then((r) => { log('joined', { ok: !!r, seat: r?.seat, name: r?.name }); paint(); });
