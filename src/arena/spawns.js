// Picks a spawn point for a respawning or newly-joining entity. Returns the
// first unobstructed point (far enough from every occupied position); if
// every point is crowded, returns the least-obstructed one -- never null
// or undefined (an empty spawnPoints list is a configuration error, not a
// runtime "no spawn available" case, so that alone throws).
const MIN_SPAWN_SEPARATION = 2;

function distanceXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function pickSpawnPoint(spawnPoints, occupiedPositions = []) {
  if (spawnPoints.length === 0) {
    throw new Error('No spawn points configured for this arena.');
  }

  let leastObstructed = spawnPoints[0];
  let bestMinDistance = -Infinity;

  for (const point of spawnPoints) {
    const minDistance =
      occupiedPositions.length === 0
        ? Infinity
        : Math.min(...occupiedPositions.map((occupied) => distanceXZ(point, occupied)));

    if (minDistance >= MIN_SPAWN_SEPARATION) {
      return point;
    }
    if (minDistance > bestMinDistance) {
      bestMinDistance = minDistance;
      leastObstructed = point;
    }
  }

  return leastObstructed;
}
