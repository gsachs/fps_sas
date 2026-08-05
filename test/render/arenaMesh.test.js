import { describe, expect, it } from 'vitest';
import { buildArenaMeshes } from '../../src/render/arenaMesh.js';

// Reflects the real shape callers pass since U2: rooms plus wall.spaceId
// ownership. One accented corner room (nw), one room with no pillar of its
// own (se, matching the real SE room -- KTD3), one neutral central room, and
// one neutral corridor wall.
const FAKE_ARENA = {
  floorHalfSize: 15,
  wallHeight: 4,
  rooms: [
    { id: 'nw', x: -10, z: 10, halfX: 5, halfZ: 5 },
    { id: 'se', x: 10, z: -10, halfX: 5, halfZ: 5 },
    { id: 'central', x: 0, z: 0, halfX: 3, halfZ: 3 },
  ],
  walls: [
    { x: -10, z: 15, halfX: 5, halfY: 2, halfZ: 0.5, spaceId: 'nw' },
    { x: 10, z: -15, halfX: 5, halfY: 2, halfZ: 0.5, spaceId: 'se' },
    { x: 0, z: 3, halfX: 3, halfY: 2, halfZ: 0.5, spaceId: 'central' },
    { x: 0, z: 15, halfX: 15, halfY: 2, halfZ: 0.5, spaceId: 'corridor-top' },
    // nw's own west wall, running along Z (halfZ > halfX) -- every other
    // wall above runs along X, so this is the only one that exercises
    // buildTrimMesh's alongX=false branch.
    { x: -15, z: 10, halfX: 0.5, halfY: 2, halfZ: 5, spaceId: 'nw' },
  ],
  pillars: [
    { x: -10, z: 10, halfX: 1, halfY: 1, halfZ: 1 }, // inside nw
    { x: 0, z: 0, halfX: 1, halfY: 1, halfZ: 1 }, // inside central
    // se has none -- matches the real SE room, which has no pillar geometry.
  ],
};
const ACCENTED_WALL_COUNT = FAKE_ARENA.walls.filter((w) => ['nw', 'se'].includes(w.spaceId)).length; // 2

describe('buildArenaMeshes', () => {
  // KTD6: mesh count derives from the same descriptor arrays as the
  // physics colliders (arena.js), so the two can never drift apart the way
  // the old hardcoded 4-wall assumption could. U3 adds one trim mesh per
  // accented-room wall (KTD3) -- deliberately updated, not a silent count
  // drift: trim is visual-only and carries no collider of its own.
  it('builds one mesh per wall and per pillar, plus the ground plane and one trim per accented wall', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    expect(group.getObjectByName('ground')).toBeDefined();
    const walls = group.children.filter((child) => child.name === 'wall');
    const pillars = group.children.filter((child) => child.name === 'pillar');
    const trim = group.children.filter((child) => child.name === 'trim');
    expect(walls).toHaveLength(FAKE_ARENA.walls.length);
    expect(pillars).toHaveLength(FAKE_ARENA.pillars.length);
    expect(trim).toHaveLength(ACCENTED_WALL_COUNT);
    expect(group.children.length).toBe(
      1 + FAKE_ARENA.walls.length + FAKE_ARENA.pillars.length + ACCENTED_WALL_COUNT
    );
  });

  // Shadow flags are opt-in per mesh and silently do nothing when missed, so
  // the failure mode is a scene that looks subtly wrong with nothing broken.
  it('receives shadows on the ground so objects are visibly grounded to it', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    expect(group.getObjectByName('ground').receiveShadow).toBe(true);
  });

  it('casts and receives shadows on every wall, pillar, and trim mesh', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const solids = group.children.filter((child) => child.name !== 'ground');

    expect(solids).toHaveLength(FAKE_ARENA.walls.length + FAKE_ARENA.pillars.length + ACCENTED_WALL_COUNT);
    for (const solid of solids) {
      expect(solid.castShadow).toBe(true);
      expect(solid.receiveShadow).toBe(true);
    }
  });

  // R16: the pass adds light, not surfaces. A texture appearing here means
  // the arena quietly drifted into the deferred PBR treatment. Still true
  // with accents (R5) -- tint is a material color, never a texture map.
  it('keeps the arena untextured', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    for (const child of group.children) {
      expect(child.material.map).toBeFalsy();
    }
  });
});

describe('buildArenaMeshes: per-room accents (KTD3, R5, U1 verdict palette)', () => {
  function findWall(x, z) {
    return buildArenaMeshes(FAKE_ARENA).children.find(
      (c) => c.name === 'wall' && c.position.x === x && c.position.z === z
    );
  }

  it('tints an accented room\'s wall with its palette hue', () => {
    const nwWall = findWall(-10, 15);
    expect(`#${nwWall.material.color.getHexString()}`).toBe('#e69f00');
  });

  it('leaves a corridor wall on the neutral material', () => {
    const corridorWall = findWall(0, 15);
    expect(`#${corridorWall.material.color.getHexString()}`).toBe('#a89f8a');
  });

  it('leaves the central room\'s wall neutral -- it has no accent (R5)', () => {
    const centralWall = findWall(0, 3);
    expect(`#${centralWall.material.color.getHexString()}`).toBe('#a89f8a');
  });

  it('adds exactly one trim mesh per accented-room wall, positioned on that wall', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const trim = group.children.filter((c) => c.name === 'trim');
    expect(trim).toHaveLength(3);
    const positions = trim.map((t) => ({ x: t.position.x, z: t.position.z })).sort((a, b) => a.x - b.x);
    expect(positions).toEqual([
      { x: -15, z: 10 },
      { x: -10, z: 15 },
      { x: 10, z: -15 },
    ]);
  });

  // Every other accented wall above runs along X; this is the only one
  // whose long axis is Z, so it's what actually exercises buildTrimMesh's
  // alongX=false branch (the mirror-image overhang assignment).
  it('overhangs the long axis on a Z-running wall (mirror of the along-X case)', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const trim = group.children.find((c) => c.name === 'trim' && c.position.x === -15 && c.position.z === 10);
    const geometry = trim.geometry.parameters;
    // Source wall: halfX 0.5, halfZ 5. TRIM_LONG_OVERHANG 0.5, TRIM_THIN_OVERHANG 0.15.
    expect(geometry.width).toBeCloseTo((0.5 + 0.15) * 2); // thin overhang on X
    expect(geometry.depth).toBeCloseTo((5 + 0.5) * 2); // long overhang on Z
  });

  it('trim carries no physics -- arena.js builds colliders from arena.walls/arena.pillars, which building meshes leaves untouched', () => {
    const wallsBefore = FAKE_ARENA.walls.length;
    const pillarsBefore = FAKE_ARENA.pillars.length;
    buildArenaMeshes(FAKE_ARENA);
    expect(FAKE_ARENA.walls).toHaveLength(wallsBefore);
    expect(FAKE_ARENA.pillars).toHaveLength(pillarsBefore);
  });

  it('tints an accented room\'s pillar with the same hue as its walls', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const nwPillar = group.children.find((c) => c.name === 'pillar' && c.position.x === -10 && c.position.z === 10);
    expect(`#${nwPillar.material.color.getHexString()}`).toBe('#e69f00');
  });

  it('leaves the central room\'s pillar on the neutral material -- no accent (R5)', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const centralPillar = group.children.find((c) => c.name === 'pillar' && c.position.x === 0 && c.position.z === 0);
    expect(`#${centralPillar.material.color.getHexString()}`).toBe('#8a6a4f');
  });

  it('se -- no pillar geometry -- still gets wall tint and trim (KTD3\'s documented exception)', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const seWall = findWall(10, -15);
    const seTrim = group.children.find((c) => c.name === 'trim' && c.position.x === 10 && c.position.z === -15);
    const sePillar = group.children.find(
      (c) => c.name === 'pillar' && Math.abs(c.position.x - 10) <= 5 && Math.abs(c.position.z + 10) <= 5
    );
    expect(`#${seWall.material.color.getHexString()}`).toBe('#cc79a7');
    expect(seTrim).toBeDefined();
    expect(sePillar).toBeUndefined();
  });
});
