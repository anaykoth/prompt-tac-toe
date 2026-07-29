# SPLINTER ALLEY

A 3D darts game. Regulation board, real ballistics, and a stand full of
muppets who lose their minds in proportion to how well you throw.

Runs entirely client-side — Vite + three.js, no assets, no backend. Every
texture, sound and puppet is generated at load time, so the whole thing is one
static bundle you can drop on any host.

Lives inside the [prompt-tac-toe](../../README.md) repo as an npm workspace and
ships with the same Vercel deploy — it is a static Vite build emitted into the
Next app's `public/darts/`, so it adds nothing to the tic-tac-toe runtime.

```
npm install                 # from the repo root
npm run dev:darts           # http://localhost:5173 — game on its own
npm run test:darts          # headless physics + rules checks
npm run build               # darts -> public/darts, then next build
```

Served at **/darts**. `next.config.mjs` rewrites the bare `/darts` path to
`/darts/index.html`, since Next serves `public/` by exact filename.

## Playing

1. **Move the mouse** to aim. The reticle is where the dart wants to land.
2. **Hold left mouse and pull down** to wind up. The aim locks when you press,
   so pulling down doesn't drag your sight off target.
3. **Flick up and release.** Flick *speed* is power — land it in the green band
   on the meter. Flick *straightness* is accuracy: a sideways flick pulls the
   dart wide, and the dart wobbles in flight when you release scruffily.

Too soft and it won't reach the board. Too hard and it sprays. If you'd rather
not flick, just click and hold — an oscillating power meter takes over.

**Hold Shift to walk.** WASD to move, mouse to look, Q to hustle. You can go
anywhere in the throwing area — up to the wall, off the stage, round to gawp at
the crowd — but the oche is the oche: step over the line and the game refuses
to hand you a dart until you're back behind it. You can't throw while Shift is
down, and where you stand is where you throw from, so shifting your stance
along the line genuinely changes your angle to the board.

| key | |
|---|---|
| `Shift` (hold) | walk about |
| `B` | open the bar |
| `1`–`5` | render style |
| `Tab` | settings |
| `C` | free orbit camera |
| `Space` | recentre on the board |
| `R` | restart |

Match is 501, double out (301/701 and straight-out are in the settings).
Opponent can be hot-seat 2-player or one of three CPUs.

## The cast

Both players are visible characters, not disembodied darts. They stand about on
stage, walk to the oche when it's their turn, throw with a real arm, and sulk
or gloat depending on what landed. When the CPU is throwing the camera cuts to
a front-quarter broadcast angle so you actually watch them do it, then to the
board for the result.

| | |
|---|---|
| **BARRY (PUB)** | round, beige, flat cap, enormous red nose. Averages ~36. |
| **THE SHARK** | lanky, steel-blue, red mohawk, shades, beak. Averages ~67. |
| **UNIT 180** | pale, antennae, bow tie, tiny pupils. Averages ~100. |

## Build your puppet

`BUILD YOUR PUPPET` on the title screen opens a build-a-bear: name, build
(round / average / lanky / gremlin), height, fur, hair style and dye, nose
shape and hue, eye and pupil size, and extras (flat cap, bobble hat, shades,
bow tie, scarf). `SURPRISE ME` rolls the lot. Your choice is saved to
localStorage and is who you are at the oche from then on.

The preview lives on a podium **in the main scene** rather than in a second
WebGL context, so it's lit and post-processed exactly as it will look in play —
switch to Cathode or Feltvision while the maker is open and the preview
changes with it.

> `height` is divided by the build's vertical scale before being applied.
> Without that, a ROUND puppet at 1.58 m is visibly shorter than a LANKY one at
> the same setting and the slider is lying to you.

## Drunk mode

Scoring darts earn **points**. Points buy **drinks**. Drinks make you worse at
darts and better at earning points.

| | cost | kick |
|---|---|---|
| HALF | 45 | +0.16 |
| PINT | 90 | +0.30 |
| SHOT | 150 | +0.46 |
| THE PUPPET | 280 | +0.78 |

Drunkenness runs 0–1 (SOBER → LOOSE → MERRY → WOBBLY → GONE → HORIZONTAL) and
sobers off at 0.0075/s, so a pint lasts about three visits. It multiplies your
points by `1 + drunk × 2`, up to ×3 — and simultaneously:

- **sways the camera** on a slow Lissajous, so the world slides under a
  stationary reticle. This is the honest half of the penalty: it's visible, so
  it's something you can learn to time.
- **widens the scatter** by up to ×3.4 and adds release wobble. This is the
  dishonest half.
- warps the lens, splits the colour, and at ~0.2 up brings on double vision.
- muffles the room — the crowd bed gets low-passed the further gone you are.

Points are deliberately kept *separate* from the 501 remaining. A multiplier on
the leg score would make double-out checkouts unplannable, which would wreck
the game it's bolted onto. So the gamble is self-contained: spend points, throw
worse, earn faster. `test/barcheck.mjs` asserts a pint can pay for itself if
you keep scoring — otherwise nobody would ever drink.

## Render styles

Five looks, switchable live. All five are one uber-shader pass plus a bloom
pass, driven by per-style uniforms.

- **Alley** — the house look. ACES, gentle bloom, film grain.
- **Ink** — comic. Sobel outlines from a normal+depth buffer, posterised
  colour, halftone in the shadows.
- **Cathode** — CRT. Barrel distortion, phosphor triads, scanlines, rolling
  bar, heavy vignette.
- **Neon** — magenta/cyan grade with the bloom opened right up.
- **Feltvision** — bleach bypass, chromatic warp, and a lens that breathes
  harder the louder the crowd gets.

## How it works

```
src/
  main.js                game loop, camera rig, turn flow, throw -> launch
  core/render.js         composer, the 5 styles, normal+depth G-buffer
  core/audio.js          WebAudio synthesis — crowd bed, thuds, wire pings
  world/dartboard.js     board geometry + scoring
  world/arena.js         room, stage, bleachers, lights, seating plan
  world/crowd.js         the muppets
  game/physics.js        integration, aim solver, continuous collision
  game/dart.js           dart mesh, flight state, impact resolution
  game/throwcontrol.js   the mouse gesture
  game/walk.js           shift-to-walk, stance, oche enforcement
  game/bar.js            points, drinks, drunkenness
  game/cast.js           the two players as characters, CPU looks
  game/maker.js          build-a-puppet
  world/puppet.js        articulated puppet: anatomy, throw animation
  game/match.js          501 rules, checkout finder, CPU opponent
  game/hud.js            scoreboard, toasts, commentary
```

### Puppets

`world/puppet.js` is one articulated puppet built from real meshes; the crowd
draws the same anatomy through `InstancedMesh` because there are 130 of them.
Named characters need what instancing can't give: a throwing animation, a hand
whose world position a dart can spawn from, and accessories.

The CPU's dart is not teleported into existence — `startThrow()` returns the
time until the release frame, the game schedules the launch for exactly then,
and the dart spawns from `handWorld()`. So the animation and the physics agree
by construction rather than by a tuned fudge factor.

### The camera

Three modes: `throw` (first-person, you), `opponent` (broadcast angle on the
CPU), and `cine` (timed close-ups). Cinematics get an **expiry** rather than a
restore timer, and the resting mode is re-derived from scratch every frame
whenever no cinematic is holding.

> This replaced a set of `setTimeout`-style restore callbacks that could be
> cleared by a restart, outlive the context that scheduled them, or fire after
> a *later* cinematic had already started — a board close-up scheduled at
> +1.1 s would yank the camera off a crowd reaction that began at +1.25 s, and
> any path that failed to schedule its restore left the camera parked on the
> stands. With an expiry there is nothing to lose track of: the default
> re-asserts itself, so every path self-heals.

Walking feeds the same rig — the throw camera's position is just the player's
current stance, which is why throwing from a new spot needs no special casing.
`ThrowControl` re-casts the aim ray every frame rather than only on mouse move,
so camera sway (drunk) and camera movement (walking) actually change where the
dart goes.

### Physics

Semi-implicit Euler at a fixed 480 Hz substep with quadratic drag, plus the
flights weathervaning the nose onto the velocity vector (that's the visible
"dart settles as it flies" behaviour). Release wobble decays exponentially over
the flight.

Aiming solves the drag-free ballistic angle for the requested speed, simulates
the result *with* drag, and walks the virtual target back by the residual —
twice. That lands sub-millimetre.

> The predictor must step at exactly the same rate as the live sim. Euler's
> gravity error is linear in `dt`, so predicting at 240 Hz while simulating at
> 480 Hz leaves a ~3 mm low bias — enough to drop a dead-centre treble onto its
> wire and turn a 1.5% bounce-out rate into 34%. `test/physcheck.mjs` guards
> this.

Collision is a swept segment against the board plane, the surround, the
plaster, the floor/stage, and every dart already planted. Wire hits bounce out,
glancing hits bounce out, and a dart that lands dead on another's shaft wedges
into it.

### Scoring

Real BDO radii (bull 6.35 mm, treble band 99–107 mm, double band 162–170 mm)
and the real wire order. The checkout finder independently reproduces the exact
set of bogey numbers — 159, 162, 163, 165, 166, 168, 169 — which is a decent
sign the geometry and the rules agree.

### The crowd

~130 puppets, each one 20 body parts, all drawn as 12 `InstancedMesh`es — about
2,600 matrix writes a frame with zero allocation in the loop. Each has a
`crazy` personality multiplier and one of five meltdown flavours (windmill,
arms-up shaking, spin in place, clap, fist pump).

A throw pushes `energy` into every puppet, scaled by personality and delayed by
a random reaction time, and it decays from there. That single value drives jaw
drop, eye bulge, hair flail, bouncing, jumping, spinning, and — at the top end
— the coloured rim lights, camera shake, lens warp and confetti. Bad throws
push it negative: they fold their arms, slump and shake their heads.

Six of the standing pit hold placards. None of them are well.

### Bloom, a warning

`UnrealBloomPass` sits before `OutputPass`, so its threshold is compared
against **linear HDR** luminance, not the 0–1 display value. A lit cream
dartboard sector is ~2.0 linear; a "sensible-looking" threshold of 0.9 blooms
the entire board into a white disc. Style thresholds here are 1.5–2.1 for that
reason.

## Testing

`npm test` runs four headless suites:

- **physcheck** — ballistics, aim accuracy, bounce rates, scoring, checkouts.
- **walkcheck** — movement directions (easy to get subtly wrong: the strafe
  right-vector was inverted first time), bounds, ground height, oche legality.
- **barcheck** — the drink economy, including that a round can pay for itself.
- **match-sim** — 180 simulated matches checking the rules terminate and the
  CPU levels hit their 3-dart averages (Barry ~36, Shark ~67, Unit 180 ~100).

For visual work, `test/scene-probe.js` pastes into the browser console and
gives you `probe.step()`, `probe.cam()`, `probe.plant()`, `probe.style()` and
`probe.hype()` — it drives the loop manually, which matters because background
tabs throttle `requestAnimationFrame` to about 1 fps.

## Online play

Pick **Online — vs the other seat** in settings. Identity reuses the
tic-tac-toe player tokens: open `/darts?t=<your-token>` once and it sticks.
Seat 0 is X, seat 1 is O — the same two people.

A throw on the wire is the *launch*, not the outcome:

```json
{ "from": [0.15,1.55,2.16], "vel": [0.1,0.9,-8.1],
  "wobble": 0.06, "roll": 2.5, "magnus": 0, "seed": 3072891 }
```

Both browsers and the server run that through the identical simulation, so you
watch the same dart hit the same wire and bounce out the same way. The payload
cannot express a score, so the server derives one by re-flying the dart in
`replay.js` — the same module the client watches.

> Every random draw that can change where a dart ends up comes from
> `game/rng.js`, seeded per throw. Crowd, arena and audio randomness
> deliberately still uses `Math.random()`; those may differ between screens.
> `test/netcheck.mjs` flies 200 throws down both paths and asserts they score
> identically, at varying frame rates.

**Transport is polling, on purpose.** 3.5s idle, 650ms while you are waiting on
their dart. Darts is turn-based and this deployment reaches Postgres through a
transaction-mode pooler (no `LISTEN/NOTIFY`) with RLS shut to the anon key, so
both obvious push routes would mean new infrastructure or reopening a door
someone deliberately closed. The append-only throw log is the source of truth,
so swapping in SSE later touches nothing above `net/online.js`.

Remote darts are replayed for the spectacle but never scored locally — the
server already counted them, and doing both double-counts every dart.

Reload mid-leg and the client replays the whole log to rebuild the board.

## Taking it further

Not done yet: legs and sets, a match history, and spectators. The throw log
supports all three — a third connection could replay it read-only without any
server change.
