import { describe, expect, it } from 'vitest';
import { buildArenaMeshes } from '../../src/render/arenaMesh.js';

const FAKE_ARENA = {
  groundHalfSize: 15,
  wallHeight: 4,
  coverBoxes: [
    { x: 5, z: 5, halfX: 1, halfY: 1, halfZ: 1 },
    { x: -5, z: 5, halfX: 1, halfY: 1, halfZ: 1 },
  ],
};

describe('buildArenaMeshes', () => {
  it('builds a ground plane, four walls, and one mesh per cover box', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    expect(group.getObjectByName('ground')).toBeDefined();
    const covers = group.children.filter((child) => child.name === 'cover');
    expect(covers).toHaveLength(FAKE_ARENA.coverBoxes.length);

    // ground (1) + walls (4) + cover boxes (2) = 7
    expect(group.children.length).toBe(1 + 4 + FAKE_ARENA.coverBoxes.length);
  });

  // Shadow flags are opt-in per mesh and silently do nothing when missed, so
  // the failure mode is a scene that looks subtly wrong with nothing broken.
  it('receives shadows on the ground so objects are visibly grounded to it', () => {
    const group = buildArenaMeshes(FAKE_ARENA);

    expect(group.getObjectByName('ground').receiveShadow).toBe(true);
  });

  it('casts and receives shadows on every wall and cover box', () => {
    const group = buildArenaMeshes(FAKE_ARENA);
    const solids = group.children.filter((child) => child.name !== 'ground');

    expect(solids).toHaveLength(4 + FAKE_ARENA.coverBoxes.length);
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
