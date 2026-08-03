// Steering behaviors for bot movement (KTD4). seek/flee/wander are pure
// vector math; avoidObstacles is a stateless Rapier query (reads live world
// geometry, so not pure, but still steering rather than FSM decision-making
// -- kept here to match). No pathfinding/navmesh: the arena is convex and
// its only obstacles are small cover boxes, which a raycast deflection is
// enough to route around.
import RAPIER from '@dimforge/rapier3d-compat';

const AVOIDANCE_LOOKAHEAD = 2;
const WANDER_JITTER = 0.05; // max yaw drift per wander() call

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 1e-6) return { x: 0, z: 0 };
  return { x: vector.x / length, z: vector.z / length };
}

export function seek(fromPosition, towardPosition) {
  return normalize({ x: towardPosition.x - fromPosition.x, z: towardPosition.z - fromPosition.z });
}

export function flee(fromPosition, awayFromPosition) {
  const towards = seek(fromPosition, awayFromPosition);
  return { x: -towards.x, z: -towards.z };
}

// A gentle drift for idle/patrol -- low-stakes filler movement, not real
// navigation between waypoints.
export function wander(currentYaw, random) {
  const driftedYaw = currentYaw + (random() * 2 - 1) * WANDER_JITTER;
  return { x: Math.sin(driftedYaw), z: Math.cos(driftedYaw), yaw: driftedYaw };
}

// Casts a short ray along `desiredDirection`; if it hits something, deflects
// the direction using the hit surface normal so bots route around cover
// instead of parking against it. Returns `desiredDirection` unchanged when
// the path ahead is clear.
export function avoidObstacles(rapierWorld, position, desiredDirection, excludeCollider) {
  const origin = { x: position.x, y: position.y, z: position.z };
  const direction = { x: desiredDirection.x, y: 0, z: desiredDirection.z };
  const hit = rapierWorld.castRayAndGetNormal(
    new RAPIER.Ray(origin, direction),
    AVOIDANCE_LOOKAHEAD,
    true,
    undefined,
    undefined,
    excludeCollider
  );
  if (!hit) return desiredDirection;

  // Slide along the obstacle's surface instead of blending in the normal.
  // Projecting the normal component out of desiredDirection leaves only the
  // tangential component, which routes the bot sideways past the obstacle.
  // The previous approach (normalize(desired + normal * K)) reversed the
  // bot instead for any approach within ~48 degrees of head-on, since
  // dot(desired + normal * K, desired) goes negative there -- the bot would
  // back away, re-approach, and reverse again, oscillating in place.
  const alongNormal = desiredDirection.x * hit.normal.x + desiredDirection.z * hit.normal.z;
  const tangent = {
    x: desiredDirection.x - hit.normal.x * alongNormal,
    z: desiredDirection.z - hit.normal.z * alongNormal,
  };
  const tangentLength = Math.hypot(tangent.x, tangent.z);
  if (tangentLength < 1e-6) {
    // Exactly head-on: the tangential component vanishes, so there's no
    // "which way past it" signal to slide along. Pick a fixed perpendicular
    // to the surface normal as a deterministic (not reversing) escape.
    return normalize({ x: -hit.normal.z, z: hit.normal.x });
  }
  return { x: tangent.x / tangentLength, z: tangent.z / tangentLength };
}
