# Air Hockey · The Fuzz & Feather

Open `/air-hockey.html` for a first-person seat at the same 3D pub as Pool.
Your fuzzy hand grips the mallet, your other hand braces on the rail, and an
articulated Muppet plays across from you while the surrounding crowd drinks
and celebrates. Move the mouse over your half of the physical table; movement itself is the stroke, with no power meter or click
timing. **Space** pauses practice, **R** starts a new game. First to seven.
The three CPU opponents have different reaction times, reach speeds and aim
errors. Click the table to unlock room audio; Sound toggles it. Touch dragging
also controls the mallet. Table Settings selects opponents, shared rooms and
the same render styles used by Pool. The visible pints slider controls camera
sway, blur-like double vision and chromatic effects; Sober Up clears them.

**Mallet → Puck** in Table Settings controls strike strength: **Gentle 0.30×**,
**Pub 0.50×** (the default), or **Original 1.00×**, with a fine slider from
0.20× to 1.00×. The hand stays just as quick; only its added drive into the
puck changes. A stationary mallet still reflects an incoming shot normally.
Barry, Dot and The Shark multiply their strikes by **0.70×**, **0.90×** and
**1.15×**, respectively, independently of their movement and reaction times.
For example, at Pub strength, Dot's effective transfer is 0.45×.

Open `/air-hockey.html?room=CODE` to join the pub's shared table, then take
Sun or Moon. A second seated human starts the game; other visitors watch.
Both players see their own half at the bottom. Leaving a seat pauses the
table, and two new occupied seats start a fresh match. Both seated players
must request a rematch. Room and identity travel back to `/pub.html`.
In a shared room, Sun can set the common strike strength while waiting for a
player or between points; active rallies lock the controls. Both human seats
use the same factor with a 1.00× personal multiplier. `hockey.settings`
accepts only a finite `hitStrength` between 0.20 and 1.00 from the authorized
seat. Everyone receives the server's setting, including spectators. Match
resets and newly occupied tables preserve it; practice settings stay separate.

## The physical contract

`physics.js` is DOM-free and imported directly by the room server. Metres,
seconds, x in [-1,1], y in [-1.7,1.7]. Seat 0 defends positive y.

- `createHockeyState(settings?)` returns plain JSON state, including validated
  `settings: { hitStrength, seatPower: [1, 1] }` and contact flags.
- `stepHockey(state, [{x,y},{x,y}], dt)` mutates and returns state.
- `resetHockey(state)` resets scores and positions in place, preserving settings.
- `constrainTarget(target, seat)` clamps and sanitizes positional input.
- `HOCKEY` exposes dimensions, radii, speed limits and scoring settings.

The server receives targets, never a claimed score, puck position or hand
velocity. Mallets move toward their targets at no more than 7 m/s; their
measured motion at contact supplies the impulse. A 480 Hz internal substep
keeps the maximum relative travel far below the contact radius, preventing
fast mallets or pucks from passing through each other. Puck speed is limited
to 15 m/s, with slight air drag and lossy rail contacts. The entire puck must
fit through a goal mouth to score. A conceding player gets the next serve.
At lower transfer a soft contact can persist through a sweep; geometric
separation prevents overlap, and contact tracking prevents a new strike from
being added on every substep. After the hand stops, the puck releases at its
reduced velocity. The identical-sweep regression measures approximately
3.92 m/s at Gentle, 6.54 m/s at Pub, and 13.08 m/s at Original.

The online client predicts only mallet and in-play puck motion between
authoritative snapshots for immediate feedback. Scores, winner, phases,
goal countdown and sound/crowd event counters always come from the server;
a speculative goal cannot announce a point or end the game. It is a
small-server prototype; long-distance latency still needs playtesting and
reconciliation tuning.

The scene reuses Pool’s `buildBarRoom`, `Renderer`, `Crowd`, `Puppet`, and
synthesized `Audio`. Mouse rays intersect the table plane in world space, so
both seats retain correct perspective controls as the camera sways or the
viewport resizes. All geometry, textures and sound are procedural. No external
image, audio or font asset is needed. `node test/airhockeycheck.mjs` covers goals,
rails, fast collisions, nonfinite input, speed limits, deterministic replays
and match termination.
