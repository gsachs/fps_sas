// The v1 arena: an enclosed space with cover geometry and multiple spawn
// points (R8). Builds the shared Rapier physics world every sim system
// (movement, combat, bot line-of-sight) queries against.
import RAPIER from '@dimforge/rapier3d-compat';

const ARENA_HALF_SIZE = 15;
const WALL_HEIGHT = 4;
const WALL_THICKNESS = 0.5;

const COVER_BOXES = [
  { x: 5, z: 5, halfX: 1, halfY: 1, halfZ: 1 },
  { x: -5, z: 5, halfX: 1, halfY: 1, halfZ: 1 },
  { x: 5, z: -5, halfX: 1, halfY: 1, halfZ: 1 },
  { x: -5, z: -5, halfX: 1, halfY: 1, halfZ: 1 },
  { x: 0, z: 0, halfX: 1.5, halfY: 0.75, halfZ: 1.5 },
];

const SPAWN_POINTS = [
  { x: 10, y: 1, z: 10 },
  { x: -10, y: 1, z: 10 },
  { x: 10, y: 1, z: -10 },
  { x: -10, y: 1, z: -10 },
  { x: 0, y: 1, z: 12 },
  { x: 0, y: 1, z: -12 },
];

export function createArena() {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  rapierWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(ARENA_HALF_SIZE, 0.5, ARENA_HALF_SIZE).setTranslation(0, -0.5, 0)
  );

  const walls = [
    { x: 0, z: ARENA_HALF_SIZE, halfX: ARENA_HALF_SIZE, halfZ: WALL_THICKNESS },
    { x: 0, z: -ARENA_HALF_SIZE, halfX: ARENA_HALF_SIZE, halfZ: WALL_THICKNESS },
    { x: ARENA_HALF_SIZE, z: 0, halfX: WALL_THICKNESS, halfZ: ARENA_HALF_SIZE },
    { x: -ARENA_HALF_SIZE, z: 0, halfX: WALL_THICKNESS, halfZ: ARENA_HALF_SIZE },
  ];
  for (const wall of walls) {
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(wall.halfX, WALL_HEIGHT / 2, wall.halfZ).setTranslation(
        wall.x,
        WALL_HEIGHT / 2,
        wall.z
      )
    );
  }

  for (const box of COVER_BOXES) {
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(box.halfX, box.halfY, box.halfZ).setTranslation(box.x, box.halfY, box.z)
    );
  }

  return {
    rapierWorld,
    groundHalfSize: ARENA_HALF_SIZE,
    wallHeight: WALL_HEIGHT,
    coverBoxes: COVER_BOXES,
    spawnPoints: SPAWN_POINTS,
  };
}
