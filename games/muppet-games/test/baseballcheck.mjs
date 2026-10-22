import assert from 'node:assert/strict';
import { BaseballGame, FIELD, batPose } from '../src/baseball/model.js';

let checks = 0;
const check = (title, fn) => { fn(); checks++; console.log(`  ✓ ${title}`); };
const advance = (game, until, limit = 30) => {
  let elapsed = 0;
  while (!until(game.state) && elapsed < limit) { game.update(1 / 120); elapsed += 1 / 120; }
  assert.ok(elapsed < limit, 'simulation reaches its next state in bounded time');
};
function shot({ offset = 0, x = 0, y = 1.05, speed = 2000, bases = [false, false, false], strikes = 0 } = {}) {
  const game = new BaseballGame({ mode: 'batting', seed: 19 });
  game.setPitchMix('straight'); game.next(); game.setBatAim(x, y);
  game.state.bases = [...bases]; game.state.counts.strikes = strikes;
  const duration = .32 - Math.max(0, Math.min(1, (speed - 180) / 3320)) * .19;
  const at = game.state.pitch.duration - duration * (1.15 / 2.4) + offset;
  while (game.state.pitch.elapsed < at && game.state.phase === 'pitch') game.update(.001);
  assert.equal(game.swing({ speed }), true);
  assert.equal(game.swing({ speed }), false, 'a second gesture cannot teleport or restart the bat');
  advance(game, state => state.phase === 'result');
  return game;
}

check('straight learning pitches repeat exactly; contact uses a timed physical bat sweep', () => {
  const game = new BaseballGame({ mode: 'batting' });
  game.setPitchMix('straight'); game.next();
  assert.equal(game.state.pitch.curve, 0); assert.equal(game.state.pitch.drop, 0);
  assert.equal(game.state.pitch.speed, 25);
  const before = batPose(game.state);
  game.swing({ speed: 2000 }); game.update(.04);
  const after = batPose(game.state);
  assert.ok(after.tip.z < before.tip.z);
  assert.equal(game.state.phase, 'pitch', 'pressing swing does not manufacture contact');
  assert.ok(Math.abs(Math.hypot(after.tip.x - after.handle.x, after.tip.z - after.handle.z) - FIELD.batLength) < 1e-10);
});

check('early right-handed contact pulls left; late contact goes right', () => {
  const early = shot({ offset: -.035 }), late = shot({ offset: .035 });
  assert.ok(early.state.hit.spray < -.1);
  assert.ok(late.state.hit.spray > .1);
  assert.ok(early.state.feedback.timingMs < 0);
  assert.ok(late.state.feedback.timingMs > 0);
});

check('a badly timed stroke or wrong bat height really misses', () => {
  const early = shot({ offset: -.09 }), high = shot({ y: 1.7 });
  assert.equal(early.state.hit, null); assert.equal(high.state.hit, null);
  assert.equal(early.state.counts.strikes, 1); assert.equal(high.state.counts.strikes, 1);
});

check('barrel height changes the launch angle instead of applying random scatter', () => {
  const lower = shot({ y: 1.01 }), higher = shot({ y: 1.08 });
  assert.ok(lower.state.hit && higher.state.hit);
  assert.ok(lower.state.hit.launchAngle > higher.state.hit.launchAngle + .3);
});

check('curved pitches visibly bend in opposite directions with the same aim', () => {
  const left = new BaseballGame({ mode: 'pitching', seed: 1 });
  const right = new BaseballGame({ mode: 'pitching', seed: 1 });
  left.pitch({ targetX: 0, targetY: 1.05, speed: 25, curve: -1, drop: 0 });
  right.pitch({ targetX: 0, targetY: 1.05, speed: 25, curve: 1, drop: 0 });
  const half = left.state.pitch.duration / 2;
  while (left.state.pitch.elapsed < half) { left.update(.001); right.update(.001); }
  assert.ok(left.state.ball.x > .3); assert.ok(right.state.ball.x < -.3);
  assert.ok(Math.abs(left.state.ball.x + right.state.ball.x) < 1e-8);
});

check('three actual taken strikes retire a batter and reset the count', () => {
  const game = new BaseballGame({ mode: 'batting' }); game.setPitchMix('straight');
  for (let pitch = 0; pitch < 3; pitch++) { game.next(); advance(game, state => state.phase === 'result'); }
  assert.equal(game.state.counts.outs, 1); assert.equal(game.state.counts.strikes, 0);
  assert.equal(game.state.feedback.outcome, 'strikeout');
});

check('an uncaught foul with two strikes stays at two', () => {
  const game = shot({ offset: -.12, x: .35, y: 1.2, strikes: 2 });
  assert.equal(game.state.feedback.outcome, 'foul');
  assert.equal(game.state.counts.strikes, 2); assert.equal(game.state.counts.outs, 0);
  assert.deepEqual(game.state.bases, [false, false, false]);
});

check('ball four forces only occupied consecutive bases, including a loaded walk', () => {
  for (const [bases, expected, runs] of [
    [[false, true, true], [true, true, true], 0],
    [[true, false, true], [true, true, true], 0],
    [[true, true, true], [true, true, true], 1],
  ]) {
    const game = new BaseballGame({ mode: 'pitching', seed: 1 });
    game.state.bases = [...bases]; game.state.counts.balls = 3;
    game.pitch({ targetX: 1.2, targetY: 2.4, speed: 25, curve: 0, drop: 0 });
    advance(game, state => state.phase === 'result');
    assert.equal(game.state.feedback.outcome, 'walk');
    assert.deepEqual(game.state.bases, expected); assert.equal(game.state.score[0], runs);
    assert.equal(game.state.counts.balls, 0);
  }
});

check('a fair single advances existing runners and the visual runners reach the bases', () => {
  const game = shot({ bases: [true, true, false] });
  assert.equal(game.state.feedback.outcome, 'single');
  assert.deepEqual(game.state.bases, [true, true, true]);
  assert.equal(game.state.runners.length, 3);
  for (const runner of game.state.runners) {
    assert.equal(runner.progress, 1);
    assert.equal(runner.x, FIELD.bases[runner.to].x); assert.equal(runner.z, FIELD.bases[runner.to].z);
  }
});

check('a ball over the actual fence scores all four runners exactly once', () => {
  const game = shot({ offset: -.06, bases: [true, true, true] });
  assert.equal(game.state.feedback.outcome, 'home-run');
  assert.ok(game.state.hit.distance >= FIELD.fenceDistance);
  assert.deepEqual(game.state.score, [0, 4]); assert.deepEqual(game.state.bases, [false, false, false]);
  game.update(.25); game.update(.25); assert.equal(game.state.score[1], 4);
  assert.ok(game.state.runners.every(runner => runner.x === 0 && runner.z === 0));
});

check('infield grounders can be thrown out; airborne catches also record an out', () => {
  const ground = shot({ offset: .035 }), fly = shot({ offset: -.035 });
  assert.equal(ground.state.feedback.outcome, 'groundout'); assert.equal(fly.state.feedback.outcome, 'flyout');
  assert.equal(ground.state.counts.outs, 1); assert.equal(fly.state.counts.outs, 1);
});

check('seeded pitches and their full flight state replay deterministically', () => {
  const a = new BaseballGame({ mode: 'batting', seed: 42 }), b = new BaseballGame({ mode: 'batting', seed: 42 });
  a.next(); b.next();
  for (let i = 0; i < 50; i++) { a.update(1 / 120); b.update(1 / 120); }
  assert.deepEqual(a.state, b.state);
});

check('three innings complete through real CPU pitches, hits and outs without invalid state', () => {
  const game = new BaseballGame({ mode: 'match', innings: 3, seed: 31 });
  game.setPitchMix('straight'); let pitches = 0, visitedBottom = 0;
  while (game.state.phase !== 'finished' && pitches < 500) {
    if (game.state.phase === 'result' || game.state.phase === 'ready') {
      const oldHalf = game.state.half; game.next();
      if (oldHalf === 'top' && game.state.half === 'bottom') visitedBottom++;
      if (game.state.phase === 'finished') break;
      if (game.state.role === 'pitching') game.pitch({ targetX: 0, targetY: 1.4, speed: 39, curve: .8, drop: .6 });
      pitches++;
    }
    advance(game, state => state.phase === 'result' || state.phase === 'finished');
    assert.ok(game.state.score.every(value => Number.isInteger(value) && value >= 0));
    assert.ok(game.state.bases.length === 3);
    assert.ok([game.state.ball.x, game.state.ball.y, game.state.ball.z].every(Number.isFinite));
  }
  assert.ok(pitches < 500); assert.equal(game.state.phase, 'finished');
  assert.equal(visitedBottom, 3); assert.equal(game.state.inning, 3);
  assert.equal(game.next(), false);
});

check('untrusted control values are rejected or bounded and practice continues', () => {
  const game = new BaseballGame({ mode: 'pitching' });
  assert.equal(game.pitch({ speed: NaN }), false);
  game.setBatAim(99, -99); assert.equal(game.state.bat.x, .65); assert.equal(game.state.bat.y, .35);
  game.pitch({ targetX: 99, targetY: -99, speed: 999, curve: 99, drop: 99 });
  assert.equal(game.state.pitch.speed, 40); assert.equal(game.state.pitch.targetX, 1.2);
  assert.equal(game.state.pitch.targetY, .2); assert.equal(game.state.pitch.curve, 1);
  const before = structuredClone(game.state); game.update(NaN); assert.deepEqual(game.state, before);
  const practice = new BaseballGame({ mode: 'batting' }); practice.setPitchMix('straight');
  for (let i = 0; i < 9; i++) { practice.next(); advance(practice, state => state.phase === 'result'); }
  practice.next(); assert.equal(practice.state.phase, 'pitch'); assert.equal(practice.state.counts.outs, 0);
});


function directGame(pose = {}, { launch = true } = {}) {
  const game = new BaseballGame({ mode: 'batting', seed: 19 });
  game.setBatControl('direct'); game.setPitchMix('straight');
  game.setBatPose({ angle: 0, ...pose }); game.update(1 / 60);
  if (launch) game.next();
  return game;
}
const finishPitch = game => { advance(game, state => state.phase !== 'pitch'); return game; };

check('direct pose follows, holds and reverses exactly without automatic follow-through', () => {
  const game = new BaseballGame({ mode: 'batting' });
  assert.equal(game.state.bat.control, 'classic');
  game.setBatControl('direct'); assert.equal(game.state.bat.angle, -.85);
  game.setBatPose({ angle: .7, reach: .12, x: .2, y: 1.3 });
  assert.equal(game.state.bat.angle, -.85, 'setting a target does not teleport the bat');
  game.update(.05);
  assert.equal(game.state.bat.angle, .7); assert.equal(game.state.bat.reach, .12);
  assert.equal(game.state.bat.x, .2); assert.equal(game.state.bat.y, 1.3);
  assert.ok(game.state.bat.angularVelocity > 0);
  const pose = batPose(game.state);
  game.setBatControl('direct'); // a sensitivity edit must not recock the bat
  game.update(.05);
  assert.deepEqual(batPose(game.state), pose);
  assert.equal(game.state.bat.angularVelocity, 0); assert.equal(game.state.bat.contactSpeed, 0);
  assert.equal(game.state.bat.swinging, false);
  game.setBatPose({ angle: .3 }); game.update(.02);
  assert.equal(game.state.bat.angle, .3); assert.ok(game.state.bat.angularVelocity < 0);
  const beforePitch = batPose(game.state); game.next();
  assert.deepEqual(batPose(game.state), beforePitch, 'the next pitch preserves the presented bat');
  assert.equal(game.swing({ speed: 9000 }), false, 'direct mode cannot start a Classic animation');
});

check('a stationary presented bat bunts a real pitch without swing() or any speed gate', () => {
  const game = finishPitch(directGame());
  assert.equal(game.state.phase, 'inplay');
  assert.equal(game.state.hit.kind, 'bunt'); assert.equal(game.state.hit.timingMs, null);
  assert.equal(game.state.hit.contact.barrelSpeed, 0); assert.equal(game.state.hit.contact.angularVelocity, 0);
  assert.ok(game.state.hit.exitSpeed >= 5 && game.state.hit.exitSpeed <= 8.1);
  assert.ok(game.state.ball.vz < 0, 'the stationary bat returns the ball toward the field');
  assert.equal(game.state.bat.attempted, false, 'a bunt is not automatically a full swing attempt');
  assert.equal(game.state.stats.swings, 0); assert.equal(game.state.stats.contacts, 1);
});

check('direct control continues in play and after a result without striking the ball again', () => {
  const game = finishPitch(directGame());
  game.setBatPose({ angle: -.4, reach: .2 }); game.update(.02);
  assert.equal(game.state.bat.angle, -.4); assert.equal(game.state.bat.reach, .2);
  advance(game, state => state.phase === 'result');
  assert.equal(game.state.stats.contacts, 1);
  game.setBatPose({ angle: .6, reach: -.1 }); game.update(.03);
  assert.equal(game.state.bat.angle, .6); assert.equal(game.state.bat.reach, -.1);
  const held = batPose(game.state); game.next(); assert.deepEqual(batPose(game.state), held);
});

check('actual linear barrel velocity adds power to a direct hit', () => {
  const push = duration => {
    const game = directGame({ reach: -.15 });
    while (game.state.pitch.elapsed < game.state.pitch.duration - .01) game.update(.001);
    game.setBatPose({ reach: .25 }); game.update(duration);
    return finishPitch(game);
  };
  const soft = push(.2), firm = push(.05), hard = push(.025);
  assert.equal(soft.state.hit.contact.barrelSpeed, 2);
  assert.equal(firm.state.hit.contact.barrelSpeed, 8);
  assert.equal(hard.state.hit.contact.barrelSpeed, 16);
  assert.ok(firm.state.hit.exitSpeed > soft.state.hit.exitSpeed + 3);
  assert.ok(hard.state.hit.exitSpeed > firm.state.hit.exitSpeed + 5);
});

check('the face at contact sends squarely presented balls left or right', () => {
  const oriented = angle => {
    // Align height to the same real curved-down pitch at this presented face.
    const duration = 18.44 / 25;
    const time = (18.44 + .12 + Math.tan(angle) * .82 - .085 / Math.cos(angle)) / 25;
    const vy = (1.05 - 1.85 + .5 * FIELD.gravity * duration * duration) / duration;
    const y = 1.85 + vy * time - .5 * FIELD.gravity * time * time;
    return finishPitch(directGame({ angle, y }));
  };
  const closed = oriented(-.18), open = oriented(.18);
  assert.ok(closed.state.hit.spray < -.1); assert.ok(open.state.hit.spray > .1);
  assert.equal(closed.state.hit.contact.angle, -.18); assert.equal(open.state.hit.contact.angle, .18);
  assert.equal(open.state.hit.contact.barrelSpeed, 0);
});

check('a very fast stroke samples both moving bat and ball rather than tunnelling', () => {
  const game = directGame({ angle: 1 });
  while (game.state.pitch.elapsed < game.state.pitch.duration - .007) game.update(.001);
  game.setBatPose({ angle: -1 }); game.update(.02);
  assert.equal(game.state.phase, 'inplay');
  assert.ok(game.state.hit.contact.angle > -.4 && game.state.hit.contact.angle < .4, 'contact occurs between the endpoint poses');
  assert.equal(game.state.hit.contact.angularVelocity, -100);
  assert.ok(game.state.hit.contact.barrelSpeed > 70);
  assert.ok(game.state.hit.exitSpeed <= 85.000001, 'only implausible output energy is bounded');
  assert.equal(game.state.bat.angle, -1, 'the bat still reaches the exact requested endpoint after contact');
});

check('withdrawing or reversing a partial stroke can still make gentle physical contact', () => {
  const game = directGame({ angle: -.1 });
  while (game.state.pitch.elapsed < game.state.pitch.duration - .015) game.update(.001);
  game.setBatPose({ angle: .1 }); game.update(.12);
  assert.equal(game.state.phase, 'inplay'); assert.equal(game.state.hit.kind, 'bunt');
  assert.ok(game.state.hit.contact.angularVelocity > 0, 'contact is not limited to leftward motion');
  assert.ok(game.state.hit.contact.barrelSpeed > 0 && game.state.hit.contact.barrelSpeed < 3);
  assert.equal(game.state.bat.attempted, false);
});

check('height and forward reach change whether the physical barrel meets the pitch', () => {
  const square = finishPitch(directGame()), high = finishPitch(directGame({ y: 1.8 })), forward = finishPitch(directGame({ reach: .8 }));
  assert.ok(square.state.hit); assert.equal(high.state.hit, null); assert.equal(forward.state.hit, null);
  assert.equal(high.state.feedback.title, 'CALLED STRIKE');
  assert.equal(forward.state.bat.reach, .8);
  assert.equal(batPose(forward.state).handle.z, .12 - .8);
});

check('a held bat or check swing does not turn an outside pitch into multiple strikes', () => {
  for (const full of [false, true]) {
    const game = directGame({ angle: full ? 1.15 : .2 }, { launch: false });
    game._launchPitch({ targetX: 1.2, targetY: 1.05, speed: 25, curve: 0, drop: 0 });
    game.setBatPose({ angle: full ? -.8 : -.2 }); game.update(.2);
    finishPitch(game);
    assert.equal(game.state.bat.attempted, full);
    assert.equal(game.state.counts.strikes, full ? 1 : 0);
    assert.equal(game.state.counts.balls, full ? 0 : 1);
    const counts = { ...game.state.counts };
    for (let i = 0; i < 5; i++) { game.setBatPose({ angle: i % 2 ? 1.4 : -1.4 }); game.update(.1); }
    assert.deepEqual(game.state.counts, counts, 'continued dry swings after the result cannot add strikes');
  }
});

check('direct first-touch physics stays stable across display frame partitions', () => {
  const run = dt => {
    const game = directGame();
    while (game.state.phase === 'pitch') game.update(dt);
    return game.state.hit;
  };
  const fine = run(1 / 144), coarse = run(1 / 30);
  assert.ok(Math.abs(fine.exitSpeed - coarse.exitSpeed) < .01);
  assert.ok(Math.abs(fine.launchAngle - coarse.launchAngle) < .001);
});

check('selecting direct control leaves CPU timed swings and pitching results intact', () => {
  const classic = new BaseballGame({ mode: 'pitching', seed: 31 }), direct = new BaseballGame({ mode: 'pitching', seed: 31 });
  direct.setBatControl('direct'); direct.setBatPose({ angle: -.5, reach: .5 });
  for (const game of [classic, direct]) {
    game.pitch({ targetX: 0, targetY: 1.4, speed: 39, curve: .8, drop: .6 });
    advance(game, state => state.phase === 'result');
  }
  assert.deepEqual(direct.state.counts, classic.state.counts);
  assert.deepEqual(direct.state.hit, classic.state.hit);
  assert.deepEqual(direct.state.score, classic.state.score);
});

console.log(`baseballcheck: ${checks} checks passed`);
