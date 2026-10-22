import { stepHockey } from './physics.js';

/** Predict motion between snapshots without predicting the match outcome.
 * Scores, phases, timers and event counters stay exactly as the server sent
 * them, so HUD, sounds and spectators cannot celebrate a speculative goal.
 */
export function predictHockeyMotion(state, targets, dt) {
  const predicted = structuredClone(state);
  stepHockey(predicted, targets, dt);
  state.mallets = predicted.mallets;
  // Stop at the last in-play position if prediction enters a goal. The next
  // authoritative snapshot decides whether it counted. Likewise, a predicted
  // countdown cannot serve a new puck before the server does.
  if (state.status === 'playing' && predicted.status === 'playing') {
    state.puck = predicted.puck;
    state.contacts = predicted.contacts;
  }
  return state;
}
