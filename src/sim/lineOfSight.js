// Shared eye-height line-of-sight raycast: bot sensing (fsm.js) and spawn
// safety (arena/spawnPlacement.js) both need "can A see B," differing only
// in whether A is a real capsule with its own collider to exclude.
import RAPIER from '@dimforge/rapier3d-compat';
import { EYE_HEIGHT, CAPSULE_RADIUS } from './movement.js';

// Stop short of the target's own capsule surface, not just its centre --
// otherwise the ray reaches in, legitimately hits the target itself, and
// that hit gets misread as "something is blocking the view of them" (see
// docs/solutions/logic-errors/: with only a flat 0.1 buffer, a target 3.2
// units away -- well within its own 0.3-radius capsule surface at ~2.9
// units -- registered as blocked even with a dead-clear line to it).
const LOS_SURFACE_BACKOFF = 0.05;

// excludeCollider is optional: pass the observer's own collider when it has
// one (an entity casting the ray, per fsm.js) so the ray doesn't
// immediately self-hit at its own origin; omit it when the origin has no
// collider at all (an unoccupied candidate point, per spawnPlacement.js).
export function hasLineOfSight(rapierWorld, fromPosition, toPosition, excludeCollider) {
  const origin = { x: fromPosition.x, y: fromPosition.y + EYE_HEIGHT, z: fromPosition.z };
  const target = { x: toPosition.x, y: toPosition.y + EYE_HEIGHT, z: toPosition.z };
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) return true;
  const direction = { x: dx / distance, y: dy / distance, z: dz / distance };

  const hit = rapierWorld.castRay(
    new RAPIER.Ray(origin, direction),
    Math.max(distance - CAPSULE_RADIUS - LOS_SURFACE_BACKOFF, 0),
    true,
    undefined,
    undefined,
    excludeCollider
  );
  return !hit;
}
