import { LOCAL_PLAYER_ID } from './entityIds.js';

// Exists so the per-tick command-gathering logic -- U3/U4/U5's fixes: local-
// player sampling, active/dead bot skipping, corpse-liveness threading --
// can be unit-tested without pulling in main.js's entire composition-root
// state. `sim`, `bots`, and `inputSampler` are all passed directly, not via
// getters: main.js builds this call inside the object literal passed to
// `const sim = createSimulation({...})`, so `sim` hasn't finished being
// assigned at the moment the wiring closure is *written* -- but that
// closure (`() => gatherCommands({ sim, bots, inputSampler })`) only
// *runs* later, once sim.tick() genuinely calls it, by which point `sim`
// is fully assigned and never reassigned again. A getter is only needed
// for a value that changes *after* the point where a caller might read it
// (testHooks.js's getMatchElapsedSeconds/getLastRenderState wrap `let`
// bindings reassigned every tick, read by hooks invoked much later,
// asynchronously); `sim`, `bots`, and `inputSampler` are none of that.
export function gatherCommands({ sim, bots, inputSampler }) {
  const commands = new Map([[LOCAL_PLAYER_ID, inputSampler.sample()]]);
  const playerEntity = sim.world.getEntity(LOCAL_PLAYER_ID);
  for (const { id, bot, active } of bots) {
    if (!active) continue; // not yet unlocked by the ramp -- frozen in place, no command at all
    const botEntity = sim.world.getEntity(id);
    // A bot still falling to its spawn point gets no command at all, the
    // same treatment a not-yet-unlocked one gets: it is visible and can be
    // shot on the way down (its collider tracks the descent), but it cannot
    // acquire, turn, move or fire until it lands.
    if (botEntity && !botEntity.dead && !botEntity.airdropping) {
      // !playerEntity.dead: a corpse is never a live target (U4) -- the
      // sim's own liveness gate, threaded in rather than the FSM guessing
      // it from position alone (Core Invariant: never pass null).
      commands.set(
        id,
        bot.sample(
          botEntity.position,
          playerEntity.position,
          botEntity.health,
          botEntity.heldWeapon,
          !playerEntity.dead,
          botEntity.yaw
        )
      );
    }
  }
  return commands;
}
