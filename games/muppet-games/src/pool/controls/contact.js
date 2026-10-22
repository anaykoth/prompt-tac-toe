import { ContactStroke, contactShot } from './contact-model.js';

export const meta = {
  id: 'contact', label: 'Contact stroke', shortLabel: 'CONTACT',
  description: 'Draw back, then push all the way to the ball. Speed at contact makes the shot. Release early to cancel.',
  hint: 'CONTACT · MOUSE aim · WASD set spin · HOLD, DRAW BACK, PUSH THROUGH THE BALL',
};

export function createStroke(c) {
  const model = new ContactStroke();
  return {
    model,
    begin(time) {
      model.begin(time);
      c.trace.begin('contact', c.yaw, model.gap);
      c.back = c.forward = c.lateral = c.lateralAbs = c.peak = c.speed = 0;
      c.pushing = false;
    },
    move(dx, dy, time) {
      const hit = model.move(dx * c.sens, dy * c.sens, time);
      c.trace.add(model.lateral, model.distance, dy < 0);
      c.back = model.maxDraw;
      c.forward = model.forward;
      c.lateral = model.lateral;
      c.pushing = model.armed && dy < 0;
      if (hit) {
        c.speed = hit.speed;
        c.fire(contactShot(hit, c));
      }
    },
    update() {}, // Holding still never fires, regardless of previous speed.
    preview(time) {
      const hit = model.contact || model.motion(time);
      return hit.speed > 0 ? contactShot(hit, c) : null;
    },
    release() { c.cancelStroke(); },
    cancel() { model.cancel(); },
    get visualPull() { return model.distance / 1000 - 0.012; },
  };
}
