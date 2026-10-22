/**
 * Paste into the console to drive the game for visual checks without
 * depending on rAF (background tabs get throttled to ~1 fps).
 *
 *   probe.step(60)          advance one second of simulation
 *   probe.plant()           put three darts in the treble 20
 *   probe.cam('board')      board | throw | crowd | wide
 *   probe.style('ink')      switch render style
 *   probe.hype(1.6)         make the crowd lose it
 */
window.probe = (() => {
  const g = window.game;

  const step = (n = 60) => {
    const real = g.clock.getDelta.bind(g.clock);
    g.clock.getDelta = () => 1 / 60;
    for (let i = 0; i < n; i++) g._frame();
    g.clock.getDelta = real;
    g.clock.getDelta();
  };

  const V = g.camera.position.constructor;

  const CAMS = {
    throw: [[0, 1.70, 2.66], [0, 1.73, 0], 46],
    board: [[0, 1.80, 0.78], [0, 1.76, 0], 26],
    crowd: [[1.35, 1.95, 2.95], [3.6, 1.5, 1.4], 46],
    wide: [[3.2, 2.4, 4.6], [0, 1.4, 0.8], 55],
    behind: [[0, 2.5, 5.6], [0, 1.5, 0.4], 50],
  };

  const cam = (name) => {
    const [p, l, f] = CAMS[name];
    g.freeCam = false;
    g.orbit.enabled = false;
    g.timers.length = 0;
    g.rig.pos.set(...p); g.rig.tPos.set(...p);
    g.rig.look.set(...l); g.rig.tLook.set(...l);
    g.rig.fov = f; g.rig.tFov = f;
    g.camera.fov = f; g.camera.updateProjectionMatrix();
    step(3);
  };

  const plant = () => {
    for (const [dx, dy] of [[0.006, 0.100], [-0.009, 0.105], [0.013, 0.097]]) {
      g.control.frozenTarget.set(dx, 1.73 + dy, 0);
      g._playerThrow({
        target: g.control.frozenTarget.clone(), power01: 0.66,
        lateralPx: 0, straight: 1, viaMeter: false, sens: 1, assist: 1,
      });
      step(45);
      g.timers.length = 0;
      g.phase = 'aim';
      g.control.state = 'aim';
    }
  };

  const gl = g.renderer.renderer.getContext();
  const pixel = (nx, ny) => {
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.round(nx * gl.drawingBufferWidth),
      Math.round(ny * gl.drawingBufferHeight),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px,
    );
    return [px[0], px[1], px[2]];
  };

  return {
    step, cam, plant, pixel,
    style: (k) => { g._setStyle(k); step(3); },
    hype: (v) => { g.crowd.react(v, 0.25); if (v > 0.8) g.crowd.burstConfetti(500); step(24); },
    freeze: () => { g._throwCam = () => {}; g.timers.length = 0; },
    g,
  };
})();
'probe ready';
