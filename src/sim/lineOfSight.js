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
// eyeOffset defaults to EYE_HEIGHT (bot/spawn sensing, eye-to-eye) but a
// blast query (KTD4) has no eye -- a detonation point is not an entity --
// so it passes 0 via hasLineOfSightFromBlastCenter below instead of
// duplicating this function's target-capsule-surface backoff math.
export function hasLineOfSight(rapierWorld, fromPosition, toPosition, excludeCollider, eyeOffset = EYE_HEIGHT) {
  const origin = { x: fromPosition.x, y: fromPosition.y + eyeOffset, z: fromPosition.z };
  const target = { x: toPosition.x, y: toPosition.y + eyeOffset, z: toPosition.z };
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

// Blast-center variant (KTD4): a grenade's detonation point has no collider
// to exclude and, per KTD4, no eye-height offset on either end -- distance
// is measured center-to-center. Shares hasLineOfSight's exact backoff logic
// via eyeOffset: 0 rather than re-deriving it, so the self-block bug this
// file's own backoff exists to prevent (see LOS_SURFACE_BACKOFF above)
// can't silently reappear for blast queries through a second copy.
export function hasLineOfSightFromBlastCenter(rapierWorld, blastCenter, toPosition) {
  return hasLineOfSight(rapierWorld, blastCenter, toPosition, undefined, 0);
}
