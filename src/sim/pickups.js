// Map pickups (R5-R7): a sibling sim system to combat/health, not a step
// inside either of them. Fixed positions come from layout.js's PICKUPS
// descriptors; collection is a proximity check against entity.position, not
// a Rapier query -- pickups have no collider. Three.js/Rapier-free, like the
// rest of the sim layer (KTD7).
import { MACHINEGUN_MAX_AMMO, MACHINEGUN_WEAPON_ID } from './weapon.js';

// 3D distance an entity must be within to collect a pickup.
export const PICKUP_COLLECTION_RADIUS = 1.5;
// A grenade pocket's ceiling (R6's "full pocket leaves the pickup in
// place"); U4's throw implementation imports this same constant rather than
// re-declaring it.
export const GRENADE_POCKET_CAPACITY = 3;
// KTD5: countdown-remaining, ticked at world scope, mirroring health.js's
// RESPAWN_DELAY_TICKS shape exactly -- 10s at a 60Hz tick rate.
const PICKUP_RESPAWN_TICKS = 600;

function distance3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// `isLocalPlayer` is an eligibility predicate over an entity, threaded in by
// the caller (main.js) -- pickups.js has no concept of a DOM/render "local
// player id" string of its own, so R7's player-only grenade rule is decided
// by whatever this predicate says, not a hardcoded id here.
export function createPickupSystem({ pickups, isLocalPlayer }) {
  const takenPickupIds = new Set();
  const respawnTicksRemaining = new Map(); // pickupId -> ticks left until respawn

  // R6: a pickup is takeable only by an entity that can actually use it --
  // the machine gun always qualifies (even a re-pickup while already
  // holding it just refills); a grenade pickup is player-only and only
  // while the pocket has room.
  function isEligible(entity, pickup) {
    if (pickup.type === MACHINEGUN_WEAPON_ID) return true;
    return isLocalPlayer(entity) && entity.grenadeCount < GRENADE_POCKET_CAPACITY;
  }

  function collect(entity, pickup) {
    if (pickup.type === MACHINEGUN_WEAPON_ID) {
      entity.heldWeapon = MACHINEGUN_WEAPON_ID;
      entity.ammo = MACHINEGUN_MAX_AMMO;
    } else {
      entity.grenadeCount = Math.min(entity.grenadeCount + 1, GRENADE_POCKET_CAPACITY);
    }
  }

  // Called once per live, command-receiving entity per tick from inside
  // world.js's per-entity loop -- dead and parked entities never reach this
  // call at all (KTD7), so no liveness check belongs here. Same-tick
  // contention resolves by call order alone: `takenPickupIds` is mutated
  // synchronously on a successful collect, so whichever entity's turn comes
  // first in this tick (the player, per main.js's command-map ordering)
  // takes it, and every later entity's attempt this same tick already sees
  // it as taken.
  function tryCollect(entity) {
    for (const pickup of pickups) {
      if (takenPickupIds.has(pickup.id)) continue;
      if (distance3D(entity.position, pickup) > PICKUP_COLLECTION_RADIUS) continue;
      if (!isEligible(entity, pickup)) continue;

      collect(entity, pickup);
      takenPickupIds.add(pickup.id);
      respawnTicksRemaining.set(pickup.id, PICKUP_RESPAWN_TICKS);
    }
  }

  // Advances every pending pickup respawn countdown by one tick, restoring
  // any that elapse. Call once per world.step(), always -- KTD5's
  // always-running world-scope loop, mirroring health.js's tickRespawns.
  function tick() {
    for (const [pickupId, remaining] of respawnTicksRemaining) {
      if (remaining > 1) {
        respawnTicksRemaining.set(pickupId, remaining - 1);
        continue;
      }
      respawnTicksRemaining.delete(pickupId);
      takenPickupIds.delete(pickupId);
    }
  }

  // KTD7's parallel state accessor -- enough for the render layer to draw
  // every pickup and toggle its persistent mesh's visibility.
  function getPickupStates() {
    return pickups.map((pickup) => ({
      id: pickup.id,
      type: pickup.type,
      position: { x: pickup.x, y: pickup.y, z: pickup.z },
      taken: takenPickupIds.has(pickup.id),
    }));
  }

  // Match reset's explicit clear hook (R8, KTD5): every pickup returns to
  // present with no pending countdown.
  function resetAll() {
    takenPickupIds.clear();
    respawnTicksRemaining.clear();
  }

  return { tryCollect, tick, getPickupStates, resetAll };
}
