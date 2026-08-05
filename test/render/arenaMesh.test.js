import { describe, expect, it } from 'vitest';
import { buildArenaMeshes } from '../../src/render/arenaMesh.js';

const FAKE_ARENA = {
  floorHalfSize: 15,
  wallHeight: 4,
  walls: [
    { x: 0, z: 15, halfX: 15, halfY: 2, halfZ: 0.5 },
    { x: 0, z: -15, halfX: 15, halfY: 2, halfZ: 0.5 },
    { x: 15, z: 0, halfX: 0.5, halfY: 2, halfZ: 15 },
    { x: -15, z: 0, halfX: 0.5, halfY: 2, halfZ: 15 },
  ],
  pillars: [
    { x: 5, z: 5, halfX: 1, halfY: 1, halfZ: 1 },
    { x: -5, z: 5, halfX: 1, halfY: 1, halfZ: 1 },
  ],
};

describe('buildArenaMeshes', () => {
  // KTD6: mesh count derives from the same descriptor arrays as the
  // physics colliders (arena.js), so the two can never drift apart the way
  // the old hardcoded 4-wall assumption could.
  it('builds one mesh per wall and per pillar, plus the ground plane', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    expect(group.getObjectByName('ground')).toBeDefined();
    const walls = group.children.filter((child) => child.name === 'wall');
    const pillars = group.children.filter((child) => child.name === 'pillar');
    expect(walls).toHaveLength(FAKE_ARENA.walls.length);
    expect(pillars).toHaveLength(FAKE_ARENA.pillars.length);
    expect(group.children.length).toBe(1 + FAKE_ARENA.walls.length + FAKE_ARENA.pillars.length);
  });

  // Shadow flags are opt-in per mesh and silently do nothing when missed, so
  // the failure mode is a scene that looks subtly wrong with nothing broken.
  it('receives shadows on the ground so objects are visibly grounded to it', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    expect(group.getObjectByName('ground').receiveShadow).toBe(true);
  });

  it('casts and receives shadows on every wall and pillar', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const solids = group.children.filter((child) => child.name !== 'ground');

    expect(solids).toHaveLength(FAKE_ARENA.walls.length + FAKE_ARENA.pillars.length);
    for (const solid of solids) {
      expect(solid.castShadow).toBe(true);
      expect(solid.receiveShadow).toBe(true);
    }
  });

  // R16: the pass adds light, not surfaces. A texture appearing here means
  // the arena quietly drifted into the deferred PBR treatment.
  it('keeps the arena untextured', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    for (const child of group.children) {
      expect(child.material.map).toBeFalsy();
    }
  });
});
