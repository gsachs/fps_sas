// Hitscan resolution (KTD3): a fire command becomes an instant raycast
// against the arena's collider world, resolved here inside the sim step so
// it stays lag-compensatable if Phase-2 adds server authority. A per-entity
// cooldown (in sim ticks) bounds fire rate independently of how many ticks
// a render frame runs -- a queued fire edge that arrives during cooldown is
// dropped, not banked, so rapid-clicking can't queue extra shots.
import RAPIER from '@dimforge/rapier3d-compat';
import { EYE_HEIGHT } from './movement.js';

const HITSCAN_MAX_DISTANCE = 100;
const DEFAULT_COOLDOWN_TICKS = 6; // ~10 shots/sec at a 60Hz tick rate

export function createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks = DEFAULT_COOLDOWN_TICKS }) {
  const remainingCooldown = new Map(); // entityId -> ticks left before next shot allowed

  // Resolves a hitscan shot for `entity` if its command requests fire and
  // its cooldown allows it. Returns { fired, hitEntityId } -- `fired` is
  // true whenever the weapon actually discharges this tick (hit or miss),
  // so callers can trigger fire feedback (recoil, muzzle flash) even on a
  // miss; `hitEntityId` is the hit entity's id, or null (miss, blocked by
  // cover, on cooldown, or not firing).
  function resolveFire(entity, command) {
    const cooldown = remainingCooldown.get(entity.id) ?? 0;
    if (cooldown > 0) remainingCooldown.set(entity.id, cooldown - 1);

    if (!command.buttons.fire) return { fired: false, hitEntityId: null };
    if ((remainingCooldown.get(entity.id) ?? 0) > 0) return { fired: false, hitEntityId: null };

    remainingCooldown.set(entity.id, cooldownTicks);

    const shooterCollider = movementSystem.getCollider(entity.id);
    const origin = { x: entity.position.x, y: entity.position.y + EYE_HEIGHT, z: entity.position.z };
    const direction = {
      x: Math.sin(entity.yaw) * Math.cos(entity.pitch),
      y: Math.sin(entity.pitch),
      z: Math.cos(entity.yaw) * Math.cos(entity.pitch),
    };

    const hit = rapierWorld.castRay(
      new RAPIER.Ray(origin, direction),
      HITSCAN_MAX_DISTANCE,
      true,
      undefined,
      undefined,
      shooterCollider
    );

    const hitEntityId = hit ? movementSystem.getEntityIdForCollider(hit.collider) ?? null : null;
    return { fired: true, hitEntityId };
  }

  return { resolveFire };
}
