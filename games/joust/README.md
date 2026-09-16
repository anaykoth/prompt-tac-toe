# TILT ALLEY

3D jousting. Two muppets on two muppet horses, a tilt barrier, a crowd of
unwell puppets, and the same physics discipline as [Splinter Alley](../darts/README.md):
fixed 480 Hz substeps, every outcome-changing random draw from a seeded stream,
and a pass that replays bit-identically on both screens and on the server.

Lives in the prompt-tac-toe repo as a second Vite workspace. Shares the puppet,
crowd, renderer, audio, bar and rng modules with the darts game by relative
import; nothing in `games/darts` was changed to make room for it.

```
npm install                 # from the repo root
npm run dev:joust           # http://localhost:5174
npm run test:joust          # headless physics, pass determinism, rules, server
npm run build               # darts -> public/darts, joust -> public/joust, then next build
```

Served at **/joust** (Next rewrites the bare path to `/joust/index.html`).

## Controls

| input | does |
|---|---|
| mouse | aims the lance tip. The lance is heavy: the tip follows with lag and overshoot. |
| left mouse (hold) | **couch** — lowers the lance from carry to level in about half a second. Couched too early the arm tires: the tip droops and shakes. Too late and it is not level at contact. |
| right mouse (hold) | **guard** — raise the shield over the helm. Protects the head, costs reach and view. |
| `W` `S` | lean forward / back. Forward braces the seat and adds reach but bares the helm. Back tucks the helm and weakens the seat. |
| `A` `D` | lean left / right. Left squares the shield to them (bigger target, longer reach). Right angles it away (glancing hits, shorter reach). |
| `Space` (hold) | spur. Harder hits and more broken lances, but the gallop bob grows and the timing window shrinks. |
| `H` | fling your helmet at them. Once per pass, thrown with the shield hand, so the shield drops while you throw and your head is bare for the rest of the pass. |
| `B` `M` `Tab` `C` `R` `1`–`5` | bar, store, settings, free cam, restart, render style. |

### The lance follows your body

The lance pivot is fixed to the torso. Lean left and the tip swings left with
you; to hold a target through a lean you have to move the mouse right to cancel
it. Mouse aim is applied in the torso frame on top of the lean, never in world
space. `test/physcheck.mjs` asserts both halves of that.

## Physics

- **Horse.** One-dimensional gallop along the lane: charge acceleration to a
  cruise of 8.5 m/s, spur to 11. Stride length grows with speed, the saddle
  rides a two-hump gallop bob plus a pitch rock, and the rider's shoulder
  inherits it, so a few degrees of rock is a tip swinging 15 cm at the end of a
  3.2 m lance. Small seeded lateral wander, larger when the rider is drunk.
- **Rider balance.** An inverted pendulum in pitch and roll about the hip.
  WASD applies rate-limited muscle torque. A saddle spring holds you inside a
  comfort cone and turns destabilising outside it. Past the fall angle you
  tumble off and the puppet becomes a projectile on the dart integrator.
- **Lance.** A rod on the armpit with pitch and yaw driven through a
  spring-damper arm. Couch runs 0 to 1. Fatigue while couched adds droop and a
  9 Hz tremor. The tip is swept every substep against the opponent's shield
  plate, helm sphere, torso capsule, horse capsule and the barrier.
- **Impact.** First contact resolves on incidence angle, closing speed, couch
  completeness and where on the shield it lands. The impulse kicks the victim's
  balance with a lever arm, so high and outside on the shield gives the most
  unseating torque and is also the smallest, most glancing target. Lances
  shatter past an energy threshold. Both riders usually hit at once and both
  kicks apply. Contact triggers a slow-motion side-on cinematic.
- **Helmet.** A free projectile on the identical integrator. The throw leads
  the target using their velocity, iterated twice like the darts aim solver.
  A head hit dazes them: their aim spasms and their balance takes a roll kick.
- **Drunk.** The bar is the darts bar. Points buy drinks. Sway on the aim,
  noise torque on balance, delayed inputs, lens warp and double vision.

## Scoring

| result | points |
|---|---|
| glancing shield touch | 1 |
| lance broken on the shield | 3 |
| helm hit | 5 |
| unseat | 10, or the match in "to the unhorsing" mode |
| horse, or below the shield | −2, the crowd boos |
| barrier snag | lose the lance, a big kick on yourself |
| helmet on the head / body | 2 / 1 |

Best of five passes by default (3 / 5 / 7 in settings), sudden death on a tie.

## Online

A pass on the wire is both riders' input logs at 60 Hz plus a seed. Both
clients and the server run the same `simulatePass`, exactly as `replay.js`
re-flies a dart. Inputs stream live over a broadcast channel so the other
screen drives your rider with ~100 ms lag; the server resolves from the full
logs once both are in. Tables `joust_matches`, `joust_passes` (append-only),
`joust_presence`.

## Store

Masks for the helm, bought with bar points: bucket, jester, plague doctor,
horse head, Frida (flower crown, braids, the brow). Persisted in localStorage.

## Layout

```
src/
  main.js               game loop, input, camera rig, pass flow, bar, store
  game/spec.js          the shared contract: geometry, tuning, wire format
  game/pass.js          PassSim / simulatePass — horse, balance, lance, impact, helmet
  game/rules.js         match scoring, sudden death, JSON
  game/cpu.js           the three knights
  game/hud.js           scoreboard, couch meter, balance dial, toasts
  game/store.js         masks
  world/lists.js        the field, barrier, stands, royal box, torches
  world/horse.js        the muppet horse and its gallop
  world/rider.js        puppet on horse, lance, shield, helm, masks
  world/masks.js        the mask catalogue
  net/online.js         polling session
  net/live.js           realtime tick stream
```
