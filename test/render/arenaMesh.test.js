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
});
