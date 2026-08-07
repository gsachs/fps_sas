import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { LAYOUT, ROOMS, DOORWAYS, PILLARS, ROOM_ACCENTS } from '../../src/arena/layout.js';
import { createArena } from '../../src/arena/arena.js';
import { EYE_HEIGHT, CAPSULE_GROUND_OFFSET } from '../../src/sim/movement.js';

await RAPIER.init();

const ROOM_IDS = new Set(ROOMS.map((r) => r.id));
// Union of every id a wall could legitimately belong to: every room, plus
// every corridor/spoke/link space named in a doorway's connects list.
const SPACE_IDS = new Set([...ROOM_IDS, ...DOORWAYS.flatMap((d) => d.connects)]);

function roomContaining(x, z) {
  return ROOMS.find((r) => Math.abs(x - r.x) <= r.halfX && Math.abs(z - r.z) <= r.halfZ);
}

describe('layout: wall ownership (KTD4)', () => {
  it('no wall entry is unowned, and every spaceId references a real room or corridor/link space', () => {
    for (const wall of LAYOUT.walls) {
      expect(wall.spaceId).toBeTruthy();
      expect(SPACE_IDS.has(wall.spaceId)).toBe(true);
    }
  });

  it("every wall sitting on a room boundary carries that room's own id", () => {
    for (const wall of LAYOUT.walls) {
      const owner = roomContaining(wall.x, wall.z);
      if (owner) expect(wall.spaceId).toBe(owner.id);
    }
  });

  it('every corridor/link wall (outside all room boundaries) carries a non-room space id', () => {
    for (const wall of LAYOUT.walls) {
      const owner = roomContaining(wall.x, wall.z);
      if (!owner) expect(ROOM_IDS.has(wall.spaceId)).toBe(false);
    }
  });

  it("every space id named in a doorway's connects list owns at least one wall", () => {
    const wallSpaceIds = new Set(LAYOUT.walls.map((w) => w.spaceId));
    const connectedSpaceIds = new Set(DOORWAYS.flatMap((d) => d.connects));
    for (const spaceId of connectedSpaceIds) {
      expect(wallSpaceIds.has(spaceId)).toBe(true);
    }
  });
});

describe('layout: doorways (KTD5)', () => {
  it('every doorway is at least 2 units wide', () => {
    for (const doorway of DOORWAYS) {
      expect(doorway.width).toBeGreaterThanOrEqual(2);
    }
  });

  it('doorway widths are uniform across the whole map', () => {
    const widths = new Set(DOORWAYS.map((d) => d.width));
    expect(widths.size).toBe(1);
  });
});

describe('layout: districts have no dead ends (R3, R4)', () => {
  const exitCounts = new Map();
  for (const doorway of DOORWAYS) {
    for (const spaceId of doorway.connects) {
      exitCounts.set(spaceId, (exitCounts.get(spaceId) ?? 0) + 1);
    }
  }

  it('every space (room or corridor/link) has at least two doorways', () => {
    for (const spaceId of SPACE_IDS) {
      expect(exitCounts.get(spaceId) ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('at least one outlying district has exactly two doorways (U3 hosts its stuck-repath test here)', () => {
    const outlyingIds = ROOMS.map((r) => r.id).filter((id) => id !== 'landmark');
    const twoDoorwayDistricts = outlyingIds.filter((id) => exitCounts.get(id) === 2);
    expect(twoDoorwayDistricts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('layout: adjacent-space route redundancy (R3, AE2)', () => {
  // For every doorway, removing it must still leave its two connected
  // spaces reachable via some other path -- a web of overlapping loops, not
  // a single ring where every corridor is a bridge.
  function buildGraph(excludeDoorwayId) {
    const adj = new Map();
    for (const id of SPACE_IDS) adj.set(id, new Set());
    for (const d of DOORWAYS) {
      if (d.id === excludeDoorwayId) continue;
      const [a, b] = d.connects;
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
    return adj;
  }
  function reachable(adj, start, goal) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === goal) return true;
      for (const next of adj.get(current)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen.has(goal);
  }

  it('for each doorway, an alternate path exists between the spaces it connects that does not use it', () => {
    for (const doorway of DOORWAYS) {
      const [a, b] = doorway.connects;
      const graph = buildGraph(doorway.id);
      expect(reachable(graph, a, b), `doorway "${doorway.id}" is a bridge between "${a}" and "${b}"`).toBe(true);
    }
  });
});

describe('layout: navigability envelope (KTD4)', () => {
  const arena = createArena();
  arena.rapierWorld.step(); // index colliders before any query below

  function segmentClear(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return true;
    const direction = { x: dx / distance, y: 0, z: dz / distance };
    const hit = arena.rapierWorld.castRay(
      new RAPIER.Ray({ x: from.x, y: 1, z: from.z }, direction),
      distance - 1e-3, // stop just short of the target so grazing the target's own far wall never false-positives
      true
    );
    return !hit;
  }

  it('every district doorway has an unobstructed straight segment to its nav point', () => {
    for (const room of ROOMS) {
      const navPoint = room.navPoint ?? { x: room.x, z: room.z };
      const doorwaysHere = DOORWAYS.filter((d) => d.connects.includes(room.id));
      for (const doorway of doorwaysHere) {
        expect(
          segmentClear(doorway, navPoint),
          `room "${room.id}" doorway "${doorway.id}" -> nav point is blocked`
        ).toBe(true);
      }
    }
  });

  it("for every non-room space, the straight segment between each pair of its doorways clears all walls", () => {
    const roomIds = new Set(ROOMS.map((r) => r.id));
    const doorwaysBySpace = new Map();
    for (const d of DOORWAYS) {
      for (const spaceId of d.connects) {
        if (roomIds.has(spaceId)) continue;
        if (!doorwaysBySpace.has(spaceId)) doorwaysBySpace.set(spaceId, []);
        doorwaysBySpace.get(spaceId).push(d);
      }
    }
    for (const [spaceId, doors] of doorwaysBySpace) {
      for (let i = 0; i < doors.length; i++) {
        for (let j = i + 1; j < doors.length; j++) {
          expect(
            segmentClear(doors[i], doors[j]),
            `space "${spaceId}" doorways "${doors[i].id}"<->"${doors[j].id}" blocked`
          ).toBe(true);
        }
      }
    }
  });
});

describe('layout: spawn points', () => {
  function insideAnyRoom(point) {
    return ROOMS.some(
      (room) => Math.abs(point.x - room.x) <= room.halfX && Math.abs(point.z - room.z) <= room.halfZ
    );
  }
  function insideAnyPillar(point) {
    return PILLARS.some(
      (pillar) => Math.abs(point.x - pillar.x) <= pillar.halfX && Math.abs(point.z - pillar.z) <= pillar.halfZ
    );
  }

  it('every spawn point sits inside a district and outside all geometry', () => {
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

  it('places two spawn points per district (twelve total)', () => {
    expect(LAYOUT.spawnPoints).toHaveLength(12);
  });
});

describe('layout: pickups and flag site (R5, R7, KTD3)', () => {
  function insideOwnRoom(item) {
    const room = ROOMS.find((r) => r.id === item.roomId);
    return Boolean(room && Math.abs(item.x - room.x) <= room.halfX && Math.abs(item.z - room.z) <= room.halfZ);
  }
  function outsideAllPillars(item) {
    return PILLARS.every(
      (pillar) => !(Math.abs(item.x - pillar.x) <= pillar.halfX && Math.abs(item.z - pillar.z) <= pillar.halfZ)
    );
  }
  function outsideAllDoorways(item, roomId) {
    return DOORWAYS.filter((d) => d.connects.includes(roomId)).every(
      (d) => Math.hypot(item.x - d.x, item.z - d.z) >= d.width
    );
  }

  it('every pickup sits inside the district it names, outside all pillar geometry and doorway openings', () => {
    for (const pickup of LAYOUT.pickups) {
      expect(insideOwnRoom(pickup)).toBe(true);
      expect(outsideAllPillars(pickup)).toBe(true);
      expect(outsideAllDoorways(pickup, pickup.roomId)).toBe(true);
    }
  });

  it('exactly one grenade pickup in each of the five outlying districts', () => {
    for (const roomId of ['yard', 'hall', 'maze', 'warren', 'bazaar']) {
      const grenadePickups = LAYOUT.pickups.filter((p) => p.type === 'grenade' && p.roomId === roomId);
      expect(grenadePickups).toHaveLength(1);
    }
  });

  it('the flag site is a reserved, clearance-validated point in the landmark room -- data only', () => {
    expect(LAYOUT.flagSite.roomId).toBe('landmark');
    expect(insideOwnRoom(LAYOUT.flagSite)).toBe(true);
    expect(outsideAllPillars(LAYOUT.flagSite)).toBe(true);
    expect(outsideAllDoorways(LAYOUT.flagSite, 'landmark')).toBe(true);
  });
});

describe('layout: accent map (KTD4, R9)', () => {
  it('covers exactly the five outlying district ids', () => {
    const outlyingIds = ROOMS.map((r) => r.id).filter((id) => id !== 'landmark').sort();
    expect(Object.keys(ROOM_ACCENTS).sort()).toEqual(outlyingIds);
  });

  it('uses five distinct, non-blue hues', () => {
    const hues = Object.values(ROOM_ACCENTS);
    expect(new Set(hues).size).toBe(5);
    for (const hue of hues) {
      const b = hue & 0xff;
      const g = (hue >> 8) & 0xff;
      const r = (hue >> 16) & 0xff;
      expect(b).toBeLessThanOrEqual(Math.max(r, g)); // not blue-dominant
    }
  });

  it('the landmark room has no accent entry -- resolves neutral', () => {
    expect(ROOM_ACCENTS.landmark).toBeUndefined();
  });
});

describe('layout: whole-map sightlines (R4, AE4)', () => {
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

  // Representative standing positions, derived from the layout data rather
  // than hand-copied: every room centre, plus the midpoint of every
  // corridor/spoke/link space (averaging that space's own two doorways).
  function midpointsOfNonRoomSpaces() {
    const roomIds = new Set(ROOMS.map((r) => r.id));
    const doorwaysBySpace = new Map();
    for (const d of DOORWAYS) {
      for (const spaceId of d.connects) {
        if (roomIds.has(spaceId)) continue;
        if (!doorwaysBySpace.has(spaceId)) doorwaysBySpace.set(spaceId, []);
        doorwaysBySpace.get(spaceId).push(d);
      }
    }
    return [...doorwaysBySpace.values()].map((doors) => ({
      x: doors.reduce((sum, d) => sum + d.x, 0) / doors.length,
      z: doors.reduce((sum, d) => sum + d.z, 0) / doors.length,
    }));
  }

  const STANDING_POSITIONS = [...ROOMS.map((room) => ({ x: room.x, z: room.z })), ...midpointsOfNonRoomSpaces()];

  it('at least one room is fully hidden from every representative standing position', () => {
    const arena = createArena();
    arena.rapierWorld.step();
    for (const position of STANDING_POSITIONS) {
      const anyRoomFullyHidden = ROOMS.some((room) => roomFullyHidden(arena.rapierWorld, position, room));
      expect(anyRoomFullyHidden, `position (${position.x},${position.z}) sees every room`).toBe(true);
    }
  });

  it("the yard's longest sightline terminates inside the yard, not beyond it", () => {
    const arena = createArena();
    arena.rapierWorld.step();
    const yard = ROOMS.find((r) => r.id === 'yard');
    // The yard's own far corners, looking along its longest (open) axis --
    // KTD4's accepted exception is that this may be long, but it must still
    // end at the yard's own walls, never reach past its doorways into
    // another district's open interior.
    const farCorners = [
      { x: yard.x - yard.halfX, z: yard.z - yard.halfZ },
      { x: yard.x - yard.halfX, z: yard.z + yard.halfZ },
      { x: yard.x + yard.halfX, z: yard.z - yard.halfZ },
      { x: yard.x + yard.halfX, z: yard.z + yard.halfZ },
    ];
    for (const other of ROOMS) {
      if (other.id === 'yard') continue;
      const otherIsVisible = !roomFullyHidden(arena.rapierWorld, { x: yard.x, z: yard.z }, other);
      expect(otherIsVisible, `yard's centre sees into district "${other.id}"`).toBe(false);
    }
    // No far corner sees any other room's centre either.
    for (const corner of farCorners) {
      for (const other of ROOMS) {
        if (other.id === 'yard') continue;
        expect(hasLineOfSight(arena.rapierWorld, corner, { x: other.x, z: other.z })).toBe(false);
      }
    }
  });
});
