import { createWorld } from './world.js';
import { createFixedStepLoop } from './loop.js';

export { createCommand, createFireLatch } from './command.js';
export { createWorld } from './world.js';
export { createFixedStepLoop } from './loop.js';

// Assembles the world + fixed-step loop into the single entry point later
// units and the render layer consume: feed a real frame delta into tick(),
// then read interpolated entity state at the returned alpha. tick() also
// returns every combat event (hits/kills) produced by however many sim
// ticks that frame ran, so observers (U7's HUD) see each one exactly once
// regardless of framerate.
export function createSimulation({
  dt = 1 / 60,
  maxFrameSeconds = 0.25,
  gatherCommands,
  physics,
  combat,
  pickups,
  grenades,
}) {
  const world = createWorld({ physics, combat, pickups, grenades });
  let pendingEvents = [];
  const loop = createFixedStepLoop({
    dt,
    maxFrameSeconds,
    onStep: (stepDt) => {
      const events = world.step(gatherCommands(), stepDt);
      if (events && events.length > 0) pendingEvents.push(...events);
    },
  });

  return {
    world,
    dt,
    tick(frameDeltaSeconds) {
      pendingEvents = [];
      const alpha = loop.tick(frameDeltaSeconds);
      return { alpha, events: pendingEvents };
    },
    getRenderState(alpha) {
      return world.getRenderState(alpha);
    },
  };
}
