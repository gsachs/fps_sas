import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { buildArenaMeshes } from '../../src/render/arenaMesh.js';
import { loadSurfaceTexture } from '../../src/render/textures.js';
import { ARENA_SURFACE_TEXTURE } from '../../src/render/modelAssets.js';

// arenaMesh.js applies the shared surface map asynchronously (buildArenaMeshes
// itself must stay synchronous -- main.js does `scene.add(buildArenaMeshes(arena))`
// with no await), so the real loadSurfaceTexture (network + image decode) is
// mocked here the same way models.test.js mocks GLTFLoader: tests only need to
// prove arenaMesh.js *consumes* the loader's contract correctly (attaches what
// it's given, measures repeat from the real arena, leaves materials alone on
// failure). Whether the loader itself configures wrap/colorSpace/anisotropy and
// follows the cache/never-reject convention is textures.test.js's job.
vi.mock('../../src/render/textures.js', () => ({ loadSurfaceTexture: vi.fn() }));

// Mirrors what the real loadSurfaceTexture hands back on success, so tests here
// can assert arenaMesh.js passed the map through untouched.
function configuredTexture() {
  const texture = new THREE.Texture();
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

beforeEach(() => {
  vi.mocked(loadSurfaceTexture).mockReset();
  vi.mocked(loadSurfaceTexture).mockResolvedValue({ texture: configuredTexture(), loaded: true });
});

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

  // U3/R1: the deferred PBR treatment R16 punted on has arrived -- every
  // surface now carries the shared panel/composite detail map so walls,
  // floor, and pillars read as material, not flat colour. The map multiplies
  // under each material's existing `color` (KTD6), so this coexists with
  // every accent-hue assertion below rather than replacing them.
  it('textures every wall, pillar, ground, and trim material with the shared surface map', async () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    await vi.waitFor(() => {
      for (const child of group.children) {
        expect(child.material.map).toBeTruthy();
      }
    });

    for (const child of group.children) {
      expect(child.material.map.wrapS).toBe(THREE.RepeatWrapping);
      expect(child.material.map.wrapT).toBe(THREE.RepeatWrapping);
      expect(child.material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    }
  });

  // KTD6: the descriptor's tile size is measured, not guessed. The floor and
  // the walls/pillars sit at very different real-world scales (a 68-unit
  // floor vs. 2-5-unit pillars in the real arena), so tiling both at the
  // floor's own span would compress dozens of tiles onto one small pillar
  // face -- this proves arenaMesh.js requests two distinct repeats, each
  // derived from the real arena data it was given (not a hardcoded constant
  // that would silently stop matching the real layout).
  it('measures a floor repeat from the real floor size, and a structure repeat from the real walls\' average span', () => {
    buildArenaMeshes(FAKE_ARENA);

    const expectedFloorRepeat = (FAKE_ARENA.floorHalfSize * 2) / ARENA_SURFACE_TEXTURE.metersPerTile;
    const wallSpans = FAKE_ARENA.walls.map((wall) => Math.max(wall.halfX, wall.halfZ) * 2);
    const averageWallSpan = wallSpans.reduce((sum, span) => sum + span, 0) / wallSpans.length;
    const expectedStructureRepeat = averageWallSpan / ARENA_SURFACE_TEXTURE.metersPerTile;

    expect(loadSurfaceTexture).toHaveBeenCalledWith(
      ARENA_SURFACE_TEXTURE.colorPath,
      expect.objectContaining({ repeat: [expectedFloorRepeat, expectedFloorRepeat] })
    );
    expect(loadSurfaceTexture).toHaveBeenCalledWith(
      ARENA_SURFACE_TEXTURE.colorPath,
      expect.objectContaining({ repeat: [expectedStructureRepeat, expectedStructureRepeat] })
    );
    expect(expectedFloorRepeat).not.toBeCloseTo(expectedStructureRepeat, 1); // genuinely different tiers
  });

  // Placeholder-on-failure convention (models.js/textures.js): a failed
  // texture load must never leave a material pointing at a textureless map:
  // it leaves every material exactly as flat-coloured as it was before U3.
  it('leaves every material on its flat colour when the texture fails to load', async () => {
    let capturedPromise;
    vi.mocked(loadSurfaceTexture).mockImplementation(() => {
      capturedPromise = Promise.resolve({ texture: null, loaded: false });
      return capturedPromise;
    });

    const group = buildArenaMeshes(FAKE_ARENA);
    await capturedPromise;
    await Promise.resolve(); // let buildArenaMeshes's own .then() run

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
