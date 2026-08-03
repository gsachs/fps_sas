// A minimal bot command source: face the player, move toward them, and fire
// with imperfect aim -- the same Command shape the player emits (KTD2), so
// this is a genuine stand-in player, not special-cased simulation logic.
// Ships before the fuller FSM/steering (U11) so the "is fighting crude bots
// already fun?" gate (Success Criteria) can be answered cheaply first.
import { createCommand, createFireLatch } from '../command.js';

const MOVE_DEADZONE = 1.5; // stop closing once this close, so bots don't shove into the player
// Starting defaults, deliberately soft: with BOT_COUNT=4 (main.js) all
// converging on one player, a low interval/spread combination proved
// (via live playtest) to drop the player near-instantly with no window to
// react. Tune these -- and BOT_COUNT -- to taste; this is a starting point,
// not a considered balance decision (Outstanding Questions).
const FIRE_INTERVAL_TICKS = 45; // intent to fire ~1.3x/sec; weapon.js's cooldown still bounds actual rate

export function createBasicBot({ aimSpread = 0.15, random = Math.random } = {}) {
  const fireLatch = createFireLatch();
  let ticksSinceFire = 0;

  function sample(botPosition, playerPosition) {
    const dx = playerPosition.x - botPosition.x;
    const dz = playerPosition.z - botPosition.z;
    const distanceXZ = Math.hypot(dx, dz);
    const facingYaw = Math.atan2(dx, dz);

    ticksSinceFire += 1;
    if (ticksSinceFire >= FIRE_INTERVAL_TICKS) {
      ticksSinceFire = 0;
      fireLatch.press();
    }

    // Imperfect aim: jitter the shared yaw by a random spread so bots are
    // beatable. moveZ is expressed relative to this same yaw (as it is for
    // the player), so this is also this tick's facing/movement direction.
    const jitter = (random() * 2 - 1) * aimSpread;

    return createCommand({
      moveX: 0,
      moveZ: distanceXZ > MOVE_DEADZONE ? 1 : 0,
      yaw: facingYaw + jitter,
      pitch: 0,
      buttons: { fire: fireLatch.consume(), jump: false },
    });
  }

  return { sample };
}
