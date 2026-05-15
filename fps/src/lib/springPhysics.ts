/**
 * springPhysics.ts — semi-implicit Euler spring integrator for arm extension.
 *
 * Semi-implicit Euler — stable for stiffness up to 2/dt² (~7200 at 60fps).
 * stiffness=300, damping=18 gives under-damped (ζ≈0.52) overshoot.
 * Tune during implementation.
 *
 * T-14-02-02: NaN propagation guard — if target is not finite, skip the step.
 * If state.pos has gone NaN (e.g., from an earlier bad input), reset to 0.
 */

export interface SpringState {
  pos: number;
  vel: number;
}

/**
 * Advance spring state by one time step toward target.
 *
 * Semi-implicit Euler order:
 *   vel += force * dt  (velocity updated first)
 *   pos += vel * dt    (position updated with new velocity)
 *
 * @param state - mutable spring state (modified in place)
 * @param target - target position
 * @param dt - elapsed time in seconds
 * @param stiffness - spring stiffness constant (default 300)
 * @param damping - spring damping constant (default 18)
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  stiffness = 300,
  damping = 18,
): void {
  // T-14-02-02: guard against NaN propagation
  if (!isFinite(target)) return;
  if (!isFinite(state.pos)) {
    state.pos = 0;
    state.vel = 0;
  }

  const force = stiffness * (target - state.pos) - damping * state.vel;
  state.vel += force * dt;
  state.pos += state.vel * dt;
}
