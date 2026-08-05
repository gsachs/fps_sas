import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { LAYOUT, ROOMS, DOORWAYS } from '../../src/arena/layout.js';
import { createArena } from '../../src/arena/arena.js';
import { EYE_HEIGHT, CAPSULE_GROUND_OFFSET } from '../../src/sim/movement.js';

await RAPIER.init();

describe('layout: doorways (KTD9)', () => {
  it('every doorway is at least 2 units wide', () => {
    for (const doorway of DOORWAYS) {
      expect(doorway.width).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('layout: rooms (R3 -- no dead ends)', () => {
  it('every room has at least two doorways', () => {
    const exitCounts = new Map();
    for (const doorway of DOORWAYS) {
      for (const spaceId of doorway.connects) {
        exitCounts.set(spaceId, (exitCounts.get(spaceId) ?? 0) + 1);
      }
    }
    for (const room of ROOMS) {
      expect(exitCounts.get(room.id) ?? 0).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('layout: spawn points', () => {
  function insideAnyRoom(point) {
    return ROOMS.some(
      (room) =>
        Math.abs(point.x - room.x) <= room.halfX && Math.abs(point.z - room.z) <= room.halfZ
    );
  }
  function insideAnyPillar(point) {
    return LAYOUT.pillars.some(
      (pillar) =>
        Math.abs(point.x - pillar.x) <= pillar.halfX && Math.abs(point.z - pillar.z) <= pillar.halfZ
    );
  }

  it('every spawn point sits inside a room and outside all geometry', () => {
    for (const point of LAYOUT.spawnPoints) {
      expect(insideAnyRoom(point)).toBe(true);
      expect(insideAnyPillar(point)).toBe(false);
    }
  });

  it('respects pairwise separation between spawn points', () => {
    const MIN_SEPARATION = 2; // matches spawns.js's own MIN_SPAWN_SEPARATION
    for (let i = 0; i < LAYOUT.spawnPoints.length; i++) {
      for (let j = i + 1; j < LAYOUT.spawnPoints.length; j++) {
        const a = LAYOUT.spawnPoints[i];
        const b = LAYOUT.spawnPoints[j];
        const distance = Math.hypot(a.x - b.x, a.z - b.z);
        expect(distance).toBeGreaterThanOrEqual(MIN_SEPARATION);
      }
    }
  });
});

describe('layout: AE4 -- no reachable position sees the whole map', () => {
  const EYE_Y = CAPSULE_GROUND_OFFSET + EYE_HEIGHT;

  function hasLineOfSight(rapierWorld, from, to) {
    const origin = { x: from.x, y: EYE_Y, z: from.z };
    const target = { x: to.x, y: EYE_Y, z: to.z };
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return true;
    const direction = { x: dx / distance, y: 0, z: dz / distance };
    const hit = rapierWorld.castRay(new RAPIER.Ray(origin, direction), distance, true);
    return !hit;
  }

  // A room counts as fully occluded only if every sampled point in it --
  // its centre and all four corners -- is blocked from the standing point.
  function roomFullyHidden(rapierWorld, from, room) {
    const points = [
      { x: room.x, z: room.z },
      { x: room.x - room.halfX, z: room.z - room.halfZ },
      { x: room.x + room.halfX, z: room.z - room.halfZ },
      { x: room.x - room.halfX, z: room.z + room.halfZ },
      { x: room.x + room.halfX, z: room.z + room.halfZ },
    ];
    return points.every((point) => !hasLineOfSight(rapierWorld, from, point));
  }

  // Representative standing positions: every room centre plus every loop
  // corridor and spoke midpoint -- covers every named space in the layout.
  const STANDING_POSITIONS = [
    ...ROOMS.map((room) => ({ x: room.x, z: room.z })),
    { x: 0, z: 26 }, // corridor-top midpoint
    { x: 26, z: 0 }, // corridor-right midpoint
    { x: 0, z: -26 }, // corridor-bottom midpoint
    { x: -26, z: 0 }, // corridor-left midpoint
    { x: 0, z: 17.25 }, // spoke-north midpoint
    { x: 0, z: -17.25 }, // spoke-south midpoint
    { x: 17.25, z: 0 }, // spoke-east midpoint
    { x: -17.25, z: 0 }, // spoke-west midpoint
  ];

  it('at least one room is fully hidden from every representative standing position', () => {
    const arena = createArena();
    // Rapier only indexes newly-created colliders in the broad-phase on the
    // next world.step() -- a query cast before any step ran would silently
    // hit nothing (see steering.test.js's buildWorldWithWallAhead).
    arena.rapierWorld.step();
    for (const position of STANDING_POSITIONS) {
      const anyRoomFullyHidden = ROOMS.some((room) => roomFullyHidden(arena.rapierWorld, position, room));
      expect(anyRoomFullyHidden).toBe(true);
    }
  });
});
