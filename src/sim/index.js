import { createWorld } from './world.js';
import { createFixedStepLoop } from './loop.js';

export { createCommand, createFireLatch } from './command.js';
export { createWorld } from './world.js';
export { createFixedStepLoop } from './loop.js';

// Assembles the world + fixed-step loop into the single entry point later
// units and the render layer consume: feed a real frame delta into tick(),
// then read interpolated entity state at the returned alpha.
export function createSimulation({ dt = 1 / 60, maxFrameSeconds = 0.25, gatherCommands, physics, combat }) {
  const world = createWorld({ physics, combat });
  const loop = createFixedStepLoop({
    dt,
    maxFrameSeconds,
    onStep: (stepDt) => world.step(gatherCommands(), stepDt),
  });

  return {
    world,
    dt,
    tick(frameDeltaSeconds) {
      return loop.tick(frameDeltaSeconds);
    },
    getRenderState(alpha) {
      return world.getRenderState(alpha);
    },
  };
}
