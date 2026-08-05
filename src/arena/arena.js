// Builds the shared Rapier physics world every sim system (movement, combat,
// bot line-of-sight) queries against. Colliders are derived entirely from
// layout.js's descriptor dataset (KTD6) -- this file turns data into
// physics, nothing here decides the shape of the map.
import RAPIER from '@dimforge/rapier3d-compat';
import { LAYOUT } from './layout.js';

export function createArena() {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  rapierWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(LAYOUT.floorHalfSize, 0.5, LAYOUT.floorHalfSize).setTranslation(0, -0.5, 0)
  );

  for (const wall of LAYOUT.walls) {
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(wall.halfX, wall.halfY, wall.halfZ).setTranslation(wall.x, wall.halfY, wall.z)
    );
  }

  for (const pillar of LAYOUT.pillars) {
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(pillar.halfX, pillar.halfY, pillar.halfZ).setTranslation(
        pillar.x,
        pillar.halfY,
        pillar.z
      )
    );
  }

  return {
    rapierWorld,
    floorHalfSize: LAYOUT.floorHalfSize,
    wallHeight: LAYOUT.wallHeight,
    walls: LAYOUT.walls,
    pillars: LAYOUT.pillars,
    rooms: LAYOUT.rooms,
    doorways: LAYOUT.doorways,
    spawnPoints: LAYOUT.spawnPoints,
  };
}
