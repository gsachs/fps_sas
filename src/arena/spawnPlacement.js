// Physics-aware spawn selection (KTD7, R11): pre-filters candidates by
// enemy line of sight, then hands off to spawns.js's pickSpawnPoint (which
// stays physics-free) for the existing occupied-position spacing rule.
// Every call site -- respawn, ramp activation, match start/reset -- routes
// through this one function so the placement rule can't drift between them.
import { hasLineOfSight } from '../sim/lineOfSight.js';
import { pickSpawnPoint } from './spawns.js';

// Cast from the candidate point toward each enemy, not the other way --
// the point has no collider to self-hit at its own origin, while a real
// enemy entity does (hasLineOfSight has no excludeCollider to give it
// here). Visibility is symmetric either way, so the direction only matters
// for correctness at the ray's origin, not for the result.
function observerCount(rapierWorld, point, enemyPositions) {
  return enemyPositions.filter((enemy) => hasLineOfSight(rapierWorld, point, enemy)).length;
}

function nearestObserverDistance(point, enemyPositions) {
  return Math.min(...enemyPositions.map((enemy) => Math.hypot(point.x - enemy.x, point.z - enemy.z)));
}

// Prefers a point out of every living enemy's line of sight; when none
// exists, falls back to whichever is visible to the fewest, ties broken by
// distance to the nearest one (KTD7 -- the absolute "always hidden" rule is
// unsatisfiable once entity count approaches spawn point count). Never
// returns null: spawnPoints is expected non-empty, same contract as
// pickSpawnPoint, which this delegates to whenever a safe subset exists.
export function selectSpawnPoint(rapierWorld, spawnPoints, { enemyPositions = [], occupiedPositions = [] } = {}) {
  if (spawnPoints.length === 0) {
    throw new Error('No spawn points configured for this arena.');
  }
  if (enemyPositions.length === 0) {
    return pickSpawnPoint(spawnPoints, occupiedPositions);
  }

  const hidden = spawnPoints.filter((point) => observerCount(rapierWorld, point, enemyPositions) === 0);
  if (hidden.length > 0) {
    return pickSpawnPoint(hidden, occupiedPositions);
  }

  // No point is fully hidden: narrow to whichever are visible to the
  // fewest enemies, ranked farthest-observer-first (KTD7's tie-break), then
  // still run pickSpawnPoint over that safest tier -- falling through to a
  // raw fewest-observers pick here would silently drop the
  // occupied-position spacing rule this path is otherwise supposed to
  // share with every other spawn selection, reopening the spawn-on-top-of-
  // another-entity bug class this file exists to close.
  const observers = new Map(spawnPoints.map((point) => [point, observerCount(rapierWorld, point, enemyPositions)]));
  const minObservers = Math.min(...observers.values());
  const safestFirst = spawnPoints
    .filter((point) => observers.get(point) === minObservers)
    .sort((a, b) => nearestObserverDistance(b, enemyPositions) - nearestObserverDistance(a, enemyPositions));
  return pickSpawnPoint(safestFirst, occupiedPositions);
}
