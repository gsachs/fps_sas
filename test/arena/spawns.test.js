import { describe, expect, it } from 'vitest';
import { pickSpawnPoint } from '../../src/arena/spawns.js';

const POINTS = [
  { x: 10, y: 1, z: 10 },
  { x: -10, y: 1, z: 10 },
  { x: 10, y: 1, z: -10 },
];

describe('pickSpawnPoint', () => {
  it('returns a spawn point unobstructed by occupants', () => {
    const chosen = pickSpawnPoint(POINTS, [{ x: 10, y: 1, z: 10 }]);
    expect(chosen).not.toEqual(POINTS[0]);
  });

  it('returns the least-obstructed point rather than null when every point is crowded', () => {
    const occupied = POINTS.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const chosen = pickSpawnPoint(POINTS, occupied);
    expect(chosen).toBeDefined();
    expect(POINTS).toContainEqual(chosen);
  });

  it('throws rather than returning null when no spawn points are configured', () => {
    expect(() => pickSpawnPoint([], [])).toThrow();
  });
});
