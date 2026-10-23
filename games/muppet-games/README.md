# Muppet Games — The Fuzz & Feather

A pub full of fuzzy characters and games built around your hands. The new shared
pub links Pool, Air Hockey, Baseball and walk-up rock–paper–scissors.

## Play locally

```sh
npm install
npm run dev:pub
```

Open **http://127.0.0.1:5173/pub.html**. One command starts Vite and the room
server. Open a room, or jump straight into a game from the welcome screen.

| Game | URL | What is playable |
| --- | --- | --- |
| Shared pub | `/pub.html` | Walk with WASD or click the floor. Approach a Muppet, press E, and offer a coin wager. NPCs and other players can play RPS. |
| Pool | `/pool.html` | Eight ball against a CPU or local hot-seat opponent. Switch Classic/Contact controls on the title screen or in Tab settings. |
| Pool Lab | `/pool-lab.html` | The existing experimental pub, now with the same selectable Pool controls. |
| Air Club | `/air-hockey.html` | First-person 3D air hockey with Muppet hands, a physical opponent, rowdy crowd and adjustable drunken vision. Three CPU levels, first to seven. Enter a room code for 1v1–4v4 team play or spectating. |
| The Woolpark | `/baseball.html` | First-person 3D batting, mouse-driven pitching, and three-inning CPU games. Real bat contact, curved pitches, fielders and automatic baserunning. |
| Splinter Alley | `/index.html` | The existing Darts game. See [the Darts guide](docs/DARTS.md). |

## Felt Fairway: swing your phone

The phone-controlled golf course uses a separate ephemeral server. Start it with:

```sh
npm run phone
```

Open **http://127.0.0.1:8790/golf.html** on the computer. Scan the displayed QR
code with your phone's camera. Tap **Enable motion**, allow the browser's motion
permission, then tap **Align with screen** and allow the rear camera. Point it
at the square on the computer. **Lock now · Manual** accepts the first usable
reading; the progress bar is optional. **Use steady capture** remains available
if you prefer collecting ten readings. Lower the phone like a club at rest, then
click **Set resting position** on the computer (or tap it on the phone). A shared
two-second countdown gives you time to settle; the phone samples its resting
orientation at the end. Turn left/right to choose the shot direction. Hold the
large Swing circle to lock that direction and set a square clubface. From there,
sideways tilt opens or closes the face; it no longer changes your aim. The phone
and computer show the live face angle, and the clubhead visibly turns. The time-series model estimates face angle and return path near virtual impact;
face-to-path mismatch determines hook or slice, while face angle dominates the
starting direction.
Small face adjustments alone do not start the backswing. Make a comfortable
backswing and forward swing, and keep the circle held through the follow-through.
The forward swing hits automatically when its speed peak passes; releasing is
not the trigger. Each hold can hit once. Releasing before the hit cancels it.
Keep the phone in your hand. A backswing alone, slow handling, or a cancelled
grip never hits the ball. **Recentre** resets aim and the grip pose while preserving the optical screen reference.

**Bramble Rise** is a playable 315 m par 4 with an elevated tee, a rolling,
curved fairway, rough, three bunkers and a sloped green. Choose Driver, 3 wood,
7 iron, Pitching wedge, Sand wedge or Putter from either screen. Club distances
are approximate; hills and lies affect the result. Rough reduces contact and
roll, sand absorbs landings, and the sand wedge helps escape bunkers.

Tap **Next shot** to move to the actual landing spot. The game suggests a club
and centres the view on the pin; you can change clubs and aim before every shot.
The scorecard counts strokes, including a one-stroke penalty and return to the
previous lie for out-of-bounds shots. A slow enough roll into the cup completes
the hole. **Play again** returns to the tee. Choose one of three single-hole layouts: Bramble Rise (par 4, 315 m), Saltwind Links (par 3, 185 m), or Pine Hollow (par 5, 390 m). Changing course resets everyone’s ball and score.

**Putting** starts with a three-metre drill. Pick 1, 3, 6, 8 or 12 metres,
or the opposite side of the cup, on either screen. The steady camera keeps the
start and cup in view. Downhill arrows, centimetre elevation changes and a gold
roll guide help read the green. The guide runs the same ball physics as play,
solving for a square-face stroke with enough pace to roll about 25 cm past the
cup if it were absent. It is guidance, not automatic aiming. Hide it to practise
reading the green yourself. **Try guide with mouse** fills the mouse controls.

Hold **Putt**, make a small back-and-through stroke and keep holding. A three-sample
median rejects isolated gyro spikes; a deliberate two-degree backswing can arm a
short putt. Rotation sets aim before holding; the phone's **← / → 0.5°** buttons
add a fine adjustment that persists when you hold. Tilt still opens/closes the
face. Pace follows detected stroke speed without an extra penalty from the
unmeasured contact grade. These are game controls, not measured real putter speeds.

Hold the separate **Test swing** button on the phone to rehearse with the selected
club from your current lie. It rolls/flies a ball and shows the swing report,
without moving your scored ball, adding strokes/penalties, or passing the turn.
After it stops, hold either button immediately: **Test swing** repeats; **Swing/Putt** plays the saved ball for score. Mouse controls have separate **Test shot** and **Play shot** buttons.
Test swings (including their raw phone samples and outcomes) are labelled in
**Shot History**, with a **Use** filter for test vs scored play. Mouse simulations
remain separate from phone readings. **Swing Lab** still records free movement,
including movements that never trigger a shot, and now uses the selected club's
detection thresholds when you hold its grip.

**Flyover** shows the hole from above; **Mouse controls** lets you select a club,
power and quarter-degree aim without a phone. Switching modes or putting drills
starts a fresh score for everyone; the Test swing toggle stays as selected.

Motion requires a phone with a gyroscope and a trusted HTTPS page. The launcher
uses Cloudflare's `cloudflared` CLI to provide a temporary HTTPS address; install
the official CLI on your PATH, place it at `.tools/cloudflared`, or set
`CLOUDFLARED` to its executable path. No Cloudflare account is needed. Keep the
launcher running; the address changes each time it starts. Alternatively set
`PHONE_PUBLIC_URL` to your own HTTPS reverse proxy (including WebSocket support).
`node scripts/phone-play.mjs --local` starts only local mouse/testing mode.
`PHONE_PORT` overrides 8790.

This temporary endpoint serves the built golf/controller pages and assets only,
with a separate `/phone-ws` relay. It does not expose the pub ledger or source
files. Each QR has a single-use pairing secret which rotates after a player joins.
**Refresh QR** replaces only the join invitation and keeps existing players.
Host and each phone have different resume identities; removing a player from
**Players** revokes that phone’s identity. Reconnecting resumes
the room, but cancels the grip and requires calibration again. Keep the controller
in the foreground. The server keeps sessions in memory, so restarting it requires
fresh pairing. Computer refresh retains pairing but restarts the hole.

`npm run test:phone` checks real paired WebSockets, role isolation, one-use links,
resume/revocation, duplicate shots, malformed input, swing recognition, terrain
collision, lie effects, cup capture, tee-to-cup progression and gentle putting.
Real-device sensitivity and timing still need hands-on tuning. This is gesture
control, not measurement of the phone's complete position in space.

### Automatic shot history and tuning

**Shot history** records every held phone attempt, including early release,
sensor interruption, and cancellation, plus the corresponding launch and ball
result when a shot fires. No separate Lab recording is needed. The same shot ID
joins phone and computer data. Each record includes the player, club, mode, lie,
aim, calibration and address, raw timestamped gyroscope/orientation/acceleration,
model version, delivery estimates, launch velocity/spin, trajectory, carry, total
distance, lateral miss, final lie, penalties and holed status. Raw capture is
bounded to the last 12 seconds / 900 samples of a hold; trimming is flagged.

After a swing, the phone offers **Felt right**, **Too strong**, **Too weak**,
**Wrong direction**, **Unwanted hit**, and **Missed my swing**. Add intended
strength/shape and an optional note. The computer’s history can rate older
attempts, filter by player/club/source, replay delivery, and show landing spread.
The default phone view excludes mouse simulations. Automated checks flag impact
fallbacks, angle limits, sensor gaps, missing data and incomplete shot records.
Feedback counts describe the rated sample only; neither a low grade nor a bad
simulated landing establishes that the detector read the real swing correctly.

Files save atomically under **`recordings/golf-shots/`**, one per player/shot/session.
They survive server restarts. Live history is scoped to the current paired room;
older files remain on disk for analysis. Upload failures are visible and retry
from a bounded persistent browser outbox (100 queued events). Pending events from
an old room are never silently attached to a new game. **Export history + pending
data** exports current summaries (including swing/ball traces) and unsaved events;
full saved raw samples remain in the computer’s JSON files. Browser storage errors
are shown; keep the page open until upload succeeds or export pending data (the phone shows **Export pending shots**
when uploads are queued).
The API accepts bounded validated data, separates phone sensor events from host
ball results, and restricts phones to their own records and feedback. The session
limit is 500 attempts. Refreshing the host during flight leaves an incomplete
record, explicitly marked as pending/interrupted rather than inventing a landing.

Run `npm run analyze:golf` to summarize all saved phone sessions, grouped by player,
club and model version; `-- --include-demo` includes labelled simulations.
`npm run analyze:golf-baseline` replays the original three-swing Lab take with
explicit assumed grip windows and writes `recordings/golf-analysis/baseline-lab-replay.json`.
That replay is kept separate from real shot history: the old take has no grip
labels or ball outcomes. Current evidence supports the strong/strong/gentler power
ordering (98%, 100%, 55%); two impact fallbacks and one clamped attack angle need
validation against newly labelled shots before changing sensitivity or flight.

### Play with several phones

Open **Players + → Add phone +** on the computer. Up to eight phones can join;
each scans the current QR, saves a player name, and completes its own camera
alignment and resting-grip setup. Align one phone at a time. Other players keep
their calibration when a new player joins. A refreshed QR never kicks them out.

Each player has an independent ball, lie, club and stroke count. The display’s
**On the ball** label identifies whose phone can aim or swing. Waiting phones
show their own score and cannot affect the current shot. **Next player / shot**
lets everyone tee off first, then chooses the farthest unholed, connected ball.
The computer can also select a player in the roster after the current ball stops.
Offline players retain their score and can resume by reopening their phone page;
remove them with × if they have left. Restarting or changing practice modes resets
all players. Host page refresh restarts the balls; phone reconnect does not.

### Swing model, course scale and flight

The course uses metre units, a 42.67 mm ball, and a deliberately enlarged 324 mm cup (three times the original diameter) with a cut opening,
soil wall and recessed liner. **Cup close-up** removes the flag and shows the
hole at that scale. A faint visibility halo tracks distant balls without changing
the physical radius. Directional terrain lighting, tree shadows, close-up surface
grain and the putting slope grid help reveal depth. Procedural grass, raked sand, gravel and bark textures share world-scaled coordinates; rough grass, flowers, rocks, fences, benches and distance posts add detail. Saltwind has a shoreline outside the playable boundary. A gold 3D flight guide and cyan actual-shot tube sit in the scene with depth testing. **3D shot view** frames the flight from the side; the guide assumes square-path delivery at the power shown in the mouse controls, not a prediction of your next phone swing. The cup uses a swept crossing
and a speed/entry-distance capture test; a fast ball can skip the opening.

Each detected swing now produces a scrub/replay panel with a virtual shaft,
rotation-speed graph, delivery arrows and a score. It uses timestamped samples,
25 ms gyro smoothing, a backswing-derived hinge, and the downswing return through
the address plane (interpolated between samples). If that return is absent, the
speed peak is an explicitly labelled lower-confidence fallback. Metrics include
face angle, return path relative to the backswing plane, attack angle, face
stability, tempo, plane consistency, angular jerk (degrees/s³) and, when supplied
by the phone, gravity-free linear jerk (m/s³). Abrupt motion and face/path mismatch
reduce the game’s estimated contact efficiency; there is no random shot scatter.

Face and path set launch direction; their difference and spin loft set the spin
axis. Club loft, swing strength, estimated efficiency and the lie set speed and
spin. Flight integrates gravity, quadratic drag and Magnus lift at up to 120 Hz;
landings use terrain normals, restitution and surface friction. Rolling balls
respond to slope gravity and green/rough/sand resistance. The aerodynamic
coefficients, contact grade and mapping from phone rotation to club speed are
game approximations. A phone does **not** measure clubhead translation, real
impact location, gear effect, actual loft or a real golf ball’s spin. This is a
calibrated virtual club, not launch-monitor or coaching instrumentation. The
confidence number describes signal/model coverage, not statistical accuracy.

Model references: [Trackman face-to-path](https://support.trackmangolf.com/hc/en-us/articles/39724525751707-Parameters-Face-to-Path-Tee-to-Green),
[Trackman spin axis](https://www.trackman.com/blog/spin-axis),
[Titleist face angle and start direction](https://www.titleist.com/learning-lab/performance/golf-club-face-angle),
[USGA ball dimensions](https://www.usga.org/custom-search-pages/rules/equipment-rules/rule-14611.html),
and [W3C motion sensor fields](https://www.w3.org/TR/orientation-event/).

The regression suite covers 30/60/120 Hz swing sampling, impact interpolation,
jerk grading, mirrored hook/slice delivery, deterministic flights, real cup
capture/overruns, coarse physics steps, independent multiplayer progression,
turn isolation, calibration routing and reconnect/removal with real WebSockets.
The three recorded user swings still produce their original strong/strong/gentler
power ordering. Real phone movement still needs hands-on validation.

### Camera alignment

Pairing uses a room-specific ArUco target centred in the browser viewport. The
phone detects four corners locally, estimates camera pose with POSIT, and requires
one good reading for a manual lock, or ten for the optional steady capture.
Manual capture retains the matching camera/IMU pair and records `lockMethod:
manual` with one frame; it does not claim steady-capture quality. A usable marker
and live orientation are still required; no position is invented from a blind tap. Small hand
movements are allowed; missed frames pause progress for up to 900 ms rather than
resetting it immediately. Readings must come from distinct video frames within
2.4 seconds. Once captured, the optical/IMU pair stays ready while you tap Lock. The relay
accepts only the current paired target after the computer confirms showing it.
Closing/backgrounding/resizing the target, disconnecting, or switching away on
the phone cancels calibration. The camera stops after locking or cancellation;
no video or image data is sent to the computer or saved.

The optical pose establishes a screen frame (+x right, +y up, +z toward the player).
A rotation matrix binds the phone's device-orientation reference to that frame;
later grip recentering changes the neutral grip, not the screen reference. Both
screens can trigger the resting-position countdown. Stale sensors, backgrounding,
or disconnects cancel capture; duplicate clicks do not restart it. The computer
waits for the phone to confirm the captured pose.
The **initial camera position** is shown and saved in black-target widths. To
show estimated centimetres, measure the displayed black square (exclude the white
margin) and enter that width in the phone's distance settings. The origin is the
centre of the browser view, not necessarily the centre of the whole monitor.

The browser does not expose calibrated camera intrinsics. A 60° field of view
along the video's long edge is assumed (editable); there is no distortion model.
Position and tilt are therefore estimates, even with a measured target width.
After the camera turns off, only orientation is tracked. Translation is held at
its initial value: this is not continuous 6DoF or a reconstructed hand path.
Camera/motion permissions, real-lens accuracy and portrait/landscape behaviour
still need hands-on checks on iPhone and Android. Calibration requires working
orientation data; it never silently falls back to an arbitrary motion-only zero.

### Swing Lab: record first, tune afterward

After pairing and calibration, choose **Swing Lab** on the phone. Label the
movement and choose your hand, then tap **Record a swing**. A two-second count-in
precedes up to 12 seconds of recording. Swing naturally; using the grip button
is optional. No golf ball is hit in lab mode. **Stop & save** finishes early.
Add what you meant to do and tap **Save note**, or **Done — ready for review**.

The computer's **Swing Lab** opens when recording starts. It shows saved takes,
the three gyroscope axes, sampling rate, peak rotation, and grip/release and
recognition events. Replay the club at 1× or ¼× speed, scrub the timeline, and add
notes. This is an orientation replay, not a reconstructed path of your hands.
Raw rotation, acceleration, gravity-inclusive acceleration, orientation, and
timestamps are kept even when the game does not recognize the motion. Camera
alignment, its quality/assumptions, initial position and grip transform are saved
with each new take and used for screen-relative replay. Older takes still replay
with their original neutral pose. Unavailable
sensor fields are explicitly null. Limits: 12 takes per room, 12 seconds or
2,400 samples per take.

Completed takes save automatically to **`recordings/swing-lab/`** as individual
JSON files. Notes update that file atomically. The computer also caches the last
12 takes in its browser and offers **Download all takes**. Interrupted uploads
stay on the phone for **Retry saving take** or download. Switching away during
recording saves a partial take marked with the reason; the grip is cancelled.
These files can be read directly by Codex when you say the swings are recorded.
Only the paired phone or display can upload or retrieve takes from the live
session; recording files are never served as public static files.

## Two Pool control styles

**Classic** retains the original peak-speed stroke. **Contact** measures speed
near the moment the tip reaches the cue ball. Hold left mouse, draw back, then
push through the contact marker. Releasing early cancels; repeated practice
strokes are safe until you cross the ball. Hold Shift for fine aim. WASD sets
the bridge hand and spin before the stroke; it stays planted during the stroke.

The selector loads separate JavaScript modules in `src/pool/controls/` and saves
your preference. Switching does not reset the rack; an in-progress stroke finishes
before the pending control change applies. Esc or loss of focus cancels a stroke.
The title screen and settings describe whichever mode is selected.

The **mouse stroke trace** shows draw-back in blue and the forward push in gold,
with left/right travel, cue speed and a signed release angle. It uses the same
stroke calculation as the shot; the gold line on the cloth shows cue delivery
beside the white aim line. Spin and collisions can subsequently bend the ball.
The last trace stays visible until your next stroke, including cancelled
practice strokes. Toggle it in Tab settings. Contact's graph includes the mouse
sensitivity setting; Classic retains its original pixel mapping.

## Air Hockey: tune your touch

Air Hockey's **Table Settings → Mallet → Puck** offers Gentle (0.30×), Pub
(0.50×, default), Original (1.00×), and a fine slider. This changes the strike
impulse without slowing your hand. Barry, Dot and The Shark have personal strike
factors of 0.70×, 0.90× and 1.15×. In shared rooms, Sun can change the common
factor before play or between points; every human player receives the same factor.

## Baseball: put your hands into it

Open `/baseball.html`. The default **Connected bat · Mouse Lab** controls keep
your hand attached to the bat: move right to draw back, left to sweep, and stop
to hold it still. Forward/back mouse motion closes/opens the wrist and changes
reach slightly. **Left/right mouse buttons** raise/lower the bat, including during
the stroke. **W/S** also changes height and **A/D** moves the barrel in or out.
**C** resets your stance between pitches. Start at the plate (or click the field
to reconnect), take dry swings, then press **Space** for a pitch. Automatic pitches
are optional in the dugout. **Esc** opens the dugout and releases mouse capture.

The moving barrel must meet the actual ball. Its orientation and velocity at
contact determine direction and power. A stationary or gently pushed bat can
bunt without a swing trigger. The live guide shows the bat from above, the mouse
trail, wrist angle, barrel speed and last contact. **Classic · hold & flick**
preserves the original automatic swing for comparison. Sensitivity is adjustable
and saved locally. This initial mapping is calibrated from Mouse Lab takes 2–6
in `recordings/baseball-2026-10-15/`; browser pixels are not a physical mouse scale.

For pitching, **WASD** positions the target. **Hold left mouse, draw down, drive
up, then release while moving.** The last part of your forward gesture supplies
speed; hooking sideways adds curve. **1/2/3** selects fastball, curve or changeup.
The catcher’s target remains fixed while you throw, so placement and delivery
are separate physical jobs.

The dugout offers batting practice, pitching practice or a three-inning game.
Use **Straight pitches to learn on** for repeatable center pitches, or **The whole
bag** for mixed locations, speeds and curves. Automatic next pitches and the
strike zone can be toggled. Fielding and baserunning are automatic and simplified
in this prototype; Baseball currently plays against the CPU, with no online mode.

## Mouse Lab: record movement and explain intent

Open `/mouse-lab.html`, or click **Mouse Lab** in Baseball. This is a separate
recorder with no game rules. Name a movement, click **Record movement**, wait for
the two-second count-in, and perform it. **Esc** or **F8** finishes; **F6** marks
an optional moment. All other keys received by the page (including repeats and
modifiers), mouse buttons, wheel deltas, and the full mouse path are retained.
Only this tab's input during a take is saved. Browser/system shortcuts may be
handled outside the page; leaving the tab stops recording and saves the take.

Replay at real time or ¼ speed; the timeline shows held keys/buttons and scroll.
Describe the intended action in the notes, or scrub and attach a note to a specific
moment. Takes autosave locally, export as JSON, and remain readable in the page's
**Recording data / for Codex** panel. Click **Done — ready for Codex**, then tell
Codex the movements are recorded. Limits: 12 takes, 12 seconds and 8,000 motion
samples per take. If browser storage fills, download before leaving the page.

## Host a room for friends

One person's computer hosts the games for the session. With Node 22.12+ installed,
run from this directory:

```sh
npm ci
npm run host
```

The launcher builds the games and prints links for the host and other computers
on the same Wi-Fi/LAN. Everyone opens the LAN link, then the host creates a room
and shares its invite link. Keep the computer awake and the terminal open; Ctrl+C
ends hosting. No cloud game server or Docker is required.

For friends on other networks, install `cloudflared` and run
`npm run host -- --internet`. This explicitly creates a temporary HTTPS link to
this computer. Share that link; it expires when hosting stops and changes on
restart. The default command does not open a public tunnel.
See [the shared hosting guide](../shared/README.md#host-from-someones-computer)
for network details and Darts/Joust relay configuration.

Air Hockey supports 1v1–4v4 teams, separate tables and spectators. Every seated
player votes to restart. Pool and this folder's older Darts remain CPU/local
hot-seat games; their room links return to the shared pub. The current online
Darts and Joust live in the root Next app. Long-distance play still needs human
playtesting on the group's actual connections.

Each player starts with 250 **fictional pub coins** per room. RPS requires an
accepted stake, locks choices privately, and settles on the server. Draws,
timeouts and disconnects refund reserved coins. Balances resume with the browser's
room identity and survive server restarts. The older Pool Lab wallet is separate.
Use separate browsers/profiles when testing two players on one computer: tabs in
the same browser share an identity and the newest connection takes over.

See [the room server guide](server/README.md) for the protocol and ledger storage,
and [the Air Hockey guide](src/air-hockey/README.md) for control and physics details.

## Verification

```sh
npm test
npm run build
```

Tests cover Pool physics/rules, the existing Lab and table features, Classic and
Contact strokes, Air Hockey collisions/scoring/strength, Baseball gestures,
contact timing, pitch curves, scoring and innings, and real WebSocket room sessions.
The room suite includes hidden choices, payout idempotence, disconnect refunds,
identity resume, server restart recovery, and authoritative Air Hockey.

The games use procedural Three.js/Canvas characters and existing synthesized
audio. No generated image assets are needed. Current prototypes target desktop
mouse and keyboard.


### Locked address, practice dashboard and obstacles

Holding either phone swing button captures facing direction and the guide power.
Further yaw cannot rotate the player, change aim, or move the gold guide. The
live virtual shaft can travel left/right inside that frame, and face tilt still
changes delivery. Gold remains as a reference against the actual cyan shot.
Release before a hit to choose a new direction.

A completed test opens one practice graphic: animated shaft path, delivery
relative to the locked target, estimated face contact, a phone rotation-speed
curve, control and smoothness bars, and one suggested adjustment for the next
rep. Speed is degrees/second from the phone, not measured clubhead speed. Contact
is an explicit game estimate. The game power range currently tops out at 685°/s
for full shots and 200°/s for putts. Beyond that, extra speed gives no extra power
and reduces contact transfer, especially when plane, face or acceleration are
unstable. The model is deterministic; no random miss spread is added. Ordinary
putting pace remains speed-driven. The mouse preset **Too fast / lost control**
lets you inspect that failure case.

Trees and rocks share one deterministic placement source with their collision
shapes. Ball movement is swept against trunks, canopy cones/ellipsoids, and rock
ellipsoids, so a fast ball cannot step through a narrow trunk. Trunks and rocks
bounce/deflect it; foliage absorbs speed. These are geometric approximations,
not individual leaf/branch meshes. Obstacle contacts save with shot results and
appear in the practice result.

### Drive to your ball

Choose **Get in cart** on the computer or phone after the ball stops. The cart
uses the current player's scored ball as its destination. On the phone, raise
it like a steering wheel and tap **Centre steering**, then hold **Drive** and
turn clockwise to steer right. **Reverse**, **Brake**, and **Hop out & play** are
separate controls. Releasing a pedal or losing input applies the brake. Arrival
stops beside the ball and waits for pedal release; it never changes the lie or
score. Hop out to continue the hole. Test shots return to the saved ball first.

The arcade cart cruises at up to 58 km/h on the fairway, with a rechargeable
boost burst up to 84 km/h. Keep one thumb on **Drive**, and use the other to
hold **Drift** while turning, or **Boost** on a straight. Release Drift and
countersteer to catch the rear end; a sustained hard slide can spin out. Easing
off or braking recovers control. The boost meter refills when not boosting;
an empty boost needs to be released before another burst.

Desktop controls are W/↑, S/↓, A/D or ←/→, **Space** to drift, **Shift** to boost,
and B to brake, plus hold buttons. World-space momentum, reduced rear grip,
and yaw inertia produce slides; tyre marks, dust, steering wheels, chassis lean,
exhaust and a speed-sensitive chase camera make the motion visible. This is
intentionally arcade handling, not a real cart simulator.
The cart follows terrain and climbs steep hills with gradual speed loss based
on the slope along its travel direction. Boost adds climbing power; downhill
and cross-slope travel are never blocked by steepness alone. It can explore the
surrounding rendered hills beyond the golf ball's out-of-bounds line, slowing
near the outer edge of the ground. Trunks and rocks remain solid. Only the
active player's phone can drive.
`test/golfplaycheck.mjs` covers direction locks, obstacle sweeps, speed/control
tradeoffs, cart steering, boost, caught slides, spinouts, frame-rate consistency,
boosted obstacle hits, steep uphill/reverse/cross-slope travel, outer hills,
arrival and stale-input braking; the phone tests cover
the real message protocol and controller event handlers.
