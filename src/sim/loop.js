// Fixed-timestep accumulator (Gaffer "Fix Your Timestep!"). Decoupled from
// rendering: the caller feeds it a real frame delta once per render frame,
// it runs `onStep(dt)` a deterministic number of times, and returns the
// leftover fraction of a tick (alpha) for render-side interpolation.
export function createFixedStepLoop({ dt = 1 / 60, maxFrameSeconds = 0.25, onStep }) {
  let accumulator = 0;

  return {
    tick(frameDeltaSeconds) {
      accumulator += Math.min(frameDeltaSeconds, maxFrameSeconds);
      while (accumulator >= dt) {
        onStep(dt);
        accumulator -= dt;
      }
      return accumulator / dt;
    },
    get accumulator() {
      return accumulator;
    },
  };
}
