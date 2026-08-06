import { LOCAL_PLAYER_ID } from '../ui/names.js';

// Exists so the per-tick command-gathering logic -- U3/U4/U5's fixes: local-
// player sampling, active/dead bot skipping, corpse-liveness threading --
// can be unit-tested without pulling in main.js's entire composition-root
// state. `sim` is threaded as a getter, not a direct value: main.js builds
// this call inside the object literal passed to `const sim =
// createSimulation({...})`, so `sim` hasn't finished being assigned at the
// moment the wiring closure is written. The getter is only ever invoked
// later, once sim.tick() genuinely calls this function, by which point
// `sim` is fully assigned -- the same shape as testHooks.js's
// getMatchElapsedSeconds/getLastRenderState getters. `bots` and
// `inputSampler` are passed directly: `bots` is a `const` array only ever
// mutated via .push(), so the same reference stays valid across pushes, and
// `inputSampler` is already a stable object.
export function gatherCommands({ getSim, bots, inputSampler }) {
  const sim = getSim();
  const commands = new Map([[LOCAL_PLAYER_ID, inputSampler.sample()]]);
  const playerEntity = sim.world.getEntity(LOCAL_PLAYER_ID);
  for (const { id, bot, active } of bots) {
    if (!active) continue; // not yet unlocked by the ramp -- frozen in place, no command at all
    const botEntity = sim.world.getEntity(id);
    if (botEntity && !botEntity.dead) {
      // !playerEntity.dead: a corpse is never a live target (U4) -- the
      // sim's own liveness gate, threaded in rather than the FSM guessing
      // it from position alone (Core Invariant: never pass null).
      commands.set(
        id,
        bot.sample(botEntity.position, playerEntity.position, botEntity.health, botEntity.heldWeapon, !playerEntity.dead)
      );
    }
  }
  return commands;
}
