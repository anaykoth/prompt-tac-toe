/** Shared strike settings. Hand speed, simulation rate and wall bounce do not
 * change: this controls how much of a moving hand's strike reaches the puck. */
export const HOCKEY_PRESETS = Object.freeze({ gentle: .3, pub: .5, original: 1 });
export const HOCKEY_CPU_POWER = Object.freeze({ friendly: .7, pub: .9, shark: 1.15 });
export const HIT_STRENGTH = Object.freeze({ min: .2, max: 1, default: .5 });
const bounded = (value, min, max, fallback) => Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;

export function validHitStrength(value) {
  return Number.isFinite(value) && value >= HIT_STRENGTH.min && value <= HIT_STRENGTH.max;
}

export function normalizeHockeySettings(settings) {
  return {
    hitStrength: bounded(settings?.hitStrength, HIT_STRENGTH.min, HIT_STRENGTH.max, HIT_STRENGTH.default),
    seatPower: [0, 1].map(i => bounded(settings?.seatPower?.[i], .5, 1.25, 1)),
  };
}

export function hockeyPresetFor(value) {
  return Object.keys(HOCKEY_PRESETS).find(key => Math.abs(HOCKEY_PRESETS[key] - value) < .001) || 'custom';
}
