// The v1 arena: an enclosed space with cover geometry and multiple spawn
// points (R8). Builds the shared Rapier physics world every sim system
// (movement, combat, bot line-of-sight) queries against.
import RAPIER from '@dimforge/rapier3d-compat';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, EYE_HEIGHT } from '../sim/movement.js';

// Doubled from an initial 15 after playtest feedback that the arena felt
// cramped with 4 bots converging at once (Outstanding Questions).
const ARENA_HALF_SIZE = 30;
const WALL_HEIGHT = 4;
const WALL_THICKNESS = 0.5;

// A resting capsule's center sits (half-height + radius) above the ground
// it's snapped to (movement.js); eye height is measured from there. Cover
// boxes must clear that with real margin, derived rather than a fixed
// literal -- a previous fixed literal here already went stale once when
// CAPSULE_RADIUS widened, silently turning the centre box into geometry
// that blocked nothing (eye height rose to just above its old fixed top).
const STANDING_EYE_HEIGHT = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + EYE_HEIGHT;
const COVER_CLEARANCE = 0.5;
// Box translation puts its center at y = halfY (sitting on the ground), so
// its top is 2 * halfY -- halve the target top height back into a halfY.
const COVER_BOX_HALF_HEIGHT = (STANDING_EYE_HEIGHT + COVER_CLEARANCE) / 2;

const COVER_BOXES = [
  { x: 10, z: 10, halfX: 1, halfY: COVER_BOX_HALF_HEIGHT, halfZ: 1 },
  { x: -10, z: 10, halfX: 1, halfY: COVER_BOX_HALF_HEIGHT, halfZ: 1 },
  { x: 10, z: -10, halfX: 1, halfY: COVER_BOX_HALF_HEIGHT, halfZ: 1 },
  { x: -10, z: -10, halfX: 1, halfY: COVER_BOX_HALF_HEIGHT, halfZ: 1 },
  { x: 0, z: 0, halfX: 1.5, halfY: COVER_BOX_HALF_HEIGHT, halfZ: 1.5 },
];

const SPAWN_POINTS = [
  { x: 20, y: 1, z: 20 },
  { x: -20, y: 1, z: 20 },
  { x: 20, y: 1, z: -20 },
  { x: -20, y: 1, z: -20 },
  { x: 0, y: 1, z: 24 },
  { x: 0, y: 1, z: -24 },
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
