import { normalizeHockeySettings } from './tuning.js';

/** The same deterministic, DOM-free table runs in the browser and room server.
 * Distances are metres. Seat 0 defends +y; seat 1 defends -y.
 * Input is position only: the table derives the actual mallet velocity.
 */
export const HOCKEY = Object.freeze({
  halfWidth: 1, halfLength: 1.7, goalHalfWidth: .38,
  puckRadius: .068, malletRadius: .14, malletSpeed: 7,
  puckSpeed: 15, wallBounce: .96, malletBounce: .88,
  drag: .075, winScore: 7, goalPause: 1.25, substep: 1 / 480,
});

export function createHockeyState(settings, teamSize=1) {
  return {
    teamSize, mallets: Array.from({length:2*teamSize},(_,i)=>({x:teamSize===1?0:((Math.floor(i/2)/(teamSize-1))-.5)*1.2,y:i%2===0?1.25:-1.25,vx:0,vy:0})),
    puck: { x: 0, y: .62, vx: 0, vy: 0 },
    score: [0, 0], status: 'playing', goalTimer: 0, winner: null,
    servingSeat: 0, rally: 0, longestRally: 0, hits: 0, banks: 0,
    goals: 0, lastGoal: null, lastHit: null, time: 0,
    settings: normalizeHockeySettings(settings), contacts: Array(2*teamSize).fill(false),
  };
}

export function resetHockey(state) {
  Object.assign(state, createHockeyState(state.settings, state.teamSize ?? 1));
  return state;
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function constrainTarget(target, seat) {
  const home = seat % 2 === 0 ? 1.25 : -1.25;
  const x = Number.isFinite(target?.x) ? target.x : 0;
  const y = Number.isFinite(target?.y) ? target.y : home;
  const r = HOCKEY.malletRadius;
  return { x: clamp(x, -1 + r, 1 - r), y: seat % 2 === 0
    ? clamp(y, r + .015, 1.7 - r) : clamp(y, -1.7 + r, -r - .015) };
}

function capVelocity(body, max) {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed > max) { body.vx *= max / speed; body.vy *= max / speed; }
}

function goal(state, seat) {
  state.score[seat] += 1;
  state.goals += 1;
  state.lastGoal = seat;
  state.servingSeat = 1 - seat;
  state.goalTimer = HOCKEY.goalPause;
  state.puck.vx = 0; state.puck.vy = 0;
  if (state.score[seat] >= HOCKEY.winScore) {
    state.status = 'finished'; state.winner = seat;
  } else state.status = 'goal';
}

function walls(state) {
  const p = state.puck, c = HOCKEY;
  const side = c.halfWidth - c.puckRadius;
  if (Math.abs(p.x) > side) {
    const sign = Math.sign(p.x);
    p.x = sign * side;
    if (p.vx * sign > 0) { p.vx *= -c.wallBounce; state.banks++; }
  }
  const end = c.halfLength - c.puckRadius;
  if (Math.abs(p.y) > end) {
    const sign = Math.sign(p.y);
    // The entire puck must fit through the mouth. This also gives the four
    // square goal posts a solid collision surface instead of phantom goals.
    if (Math.abs(p.x) <= c.goalHalfWidth - c.puckRadius) {
      if (Math.abs(p.y) >= c.halfLength + c.puckRadius) goal(state, sign > 0 ? 1 : 0);
    } else {
      p.y = sign * end;
      if (p.vy * sign > 0) { p.vy *= -c.wallBounce; state.banks++; }
    }
  }
}

function substep(state, targets, dt) {
  const c = HOCKEY;
  state.time += dt;
  for (let i = 0; i < state.mallets.length; i++) {
    const m = state.mallets[i], t = targets[i];
    const dx = t.x - m.x, dy = t.y - m.y;
    const distance = Math.hypot(dx, dy);
    const travel = Math.min(distance, c.malletSpeed * dt);
    m.vx = distance > 1e-8 ? dx / distance * travel / dt : 0;
    m.vy = distance > 1e-8 ? dy / distance * travel / dt : 0;
    m.x += m.vx * dt; m.y += m.vy * dt;
  }
  if (state.status === 'finished') return;
  if (state.status === 'goal') {
    state.goalTimer -= dt;
    if (state.goalTimer <= 0) {
      state.status = 'playing'; state.rally = 0; state.lastHit = null; state.contacts = state.mallets.map(()=>false);
      Object.assign(state.puck, { x: 0, y: state.servingSeat === 0 ? .62 : -.62, vx: 0, vy: 0 });
    }
    return;
  }
  const p = state.puck;
  capVelocity(p, c.puckSpeed);
  p.x += p.vx * dt; p.y += p.vy * dt;
  const damping = Math.exp(-c.drag * dt);
  p.vx *= damping; p.vy *= damping;
  // At 480 Hz, even maximum opposing speeds travel < 0.046m per step,
  // versus a 0.208m contact radius. A fast input cannot jump through a puck.
  for (let i = 0; i < state.mallets.length; i++) {
    const m = state.mallets[i];
    let dx = p.x - m.x, dy = p.y - m.y;
    let distance = Math.hypot(dx, dy);
    const reach = c.puckRadius + c.malletRadius;
    const continuingContact = state.contacts[i];
    state.contacts[i] = distance < reach;
    if (distance >= reach) continue;
    if (distance < 1e-9) { dx = 0; dy = i % 2 === 0 ? -1 : 1; distance = 1; }
    const nx = dx / distance, ny = dy / distance;
    p.x = m.x + nx * (reach + 1e-5); p.y = m.y + ny * (reach + 1e-5);
    const puckNormal = p.vx * nx + p.vy * ny;
    const handNormal = m.vx * nx + m.vy * ny;
    const closing = puckNormal - handNormal;
    if (closing < 0) {
      // Rebound from an incoming puck is preserved even with a gentle hand.
      // Only the moving mallet's added drive is attenuated. A soft bumper can
      // remain in contact during a sweep; separation correction prevents
      // penetration without injecting a fresh strike every 1/480 second.
      const transfer = state.settings.hitStrength * state.settings.seatPower[i%2];
      const drive = handNormal > 0 ? handNormal * transfer : handNormal;
      const outgoing = continuingContact
        ? Math.max(puckNormal, -c.malletBounce * puckNormal)
        : Math.max(puckNormal, -c.malletBounce * puckNormal + (1 + c.malletBounce) * drive);
      const impulse = outgoing - puckNormal;
      p.vx += nx * impulse; p.vy += ny * impulse;
      capVelocity(p, c.puckSpeed);
      if (continuingContact) continue;
      state.hits += 1;
      if (state.lastHit !== i) {
        state.rally += 1;
        state.longestRally = Math.max(state.longestRally, state.rally);
      }
      state.lastHit = i;
    }
  }
  walls(state);
}

/** Advance by elapsed seconds (capped to 250ms after a suspended client).
 * Mutates and returns state. Pure, repeatable and safe to JSON serialize.
 */
export function stepHockey(state, targets, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  state.settings = normalizeHockeySettings(state.settings);
  if (!Array.isArray(state.contacts)) state.contacts = state.mallets.map(()=>false);
  const elapsed = Math.min(dt, .25);
  const steps = Math.ceil(elapsed / HOCKEY.substep);
  const safe = state.mallets.map((_,i)=>constrainTarget(targets?.[i],i));
  for (let n = 0; n < steps; n++) substep(state, safe, elapsed / steps);
  return state;
}
