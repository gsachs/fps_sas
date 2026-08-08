// Fog distances are the third render constant on this map tuned against a
// number nothing re-checks -- the same shape as the shadow extent and the
// sun distance, both of which went stale through an arena resize and were
// only caught by eye. This re-measures the map's real longest sightline from
// the live layout and fails when scene.js's tuning number drifts away from
// it, so a future district can't quietly move the fog out of range again.
import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../src/arena/layout.js';
import { FOG_RANGE } from '../../src/render/scene.js';
import { CAPSULE_RADIUS } from '../../src/sim/movement.js';

const SAMPLE_STEP = 1;
const RAY_STEP = 0.5;
const RAY_DIRECTIONS = 32;

// Walls are 4 units tall and cover blocks are full height, so at eye height
// every blocker is opaque and a 2-D march is exact.
function blockers() {
  return [...LAYOUT.walls, ...LAYOUT.pillars];
}

function standingPositions() {
  const boxes = blockers();
  const bound = LAYOUT.floorHalfSize;
  const standable = (x, z) =>
    !boxes.some(
      (b) => Math.abs(x - b.x) <= b.halfX + CAPSULE_RADIUS && Math.abs(z - b.z) <= b.halfZ + CAPSULE_RADIUS
    );
  const key = (i, j) => `${i},${j}`;
  const [first] = LAYOUT.spawnPoints;
  const start = [Math.round(first.x / SAMPLE_STEP), Math.round(first.z / SAMPLE_STEP)];
  const seen = new Set([key(...start)]);
  const frontier = [start];
  const positions = [];
  while (frontier.length > 0) {
    const [i, j] = frontier.pop();
    positions.push({ x: i * SAMPLE_STEP, z: j * SAMPLE_STEP });
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const [ni, nj] = [i + di, j + dj];
      const [x, z] = [ni * SAMPLE_STEP, nj * SAMPLE_STEP];
      if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
      const cell = key(ni, nj);
      if (seen.has(cell) || !standable(x, z)) continue;
      seen.add(cell);
      frontier.push([ni, nj]);
    }
  }
  return positions;
}

function longestSightline() {
  const boxes = blockers();
  const bound = LAYOUT.floorHalfSize;
  const opaque = (x, z) => boxes.some((b) => Math.abs(x - b.x) <= b.halfX && Math.abs(z - b.z) <= b.halfZ);
  let longest = 0;
  for (const from of standingPositions()) {
    for (let step = 0; step < RAY_DIRECTIONS; step += 1) {
      const angle = (step / RAY_DIRECTIONS) * Math.PI * 2;
      const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
      let distance = 0;
      for (;;) {
        distance += RAY_STEP;
        const [x, z] = [from.x + dx * distance, from.z + dz * distance];
        if (Math.abs(x) > bound || Math.abs(z) > bound || opaque(x, z)) break;
      }
      if (distance > longest) longest = distance;
    }
  }
  return longest;
}

describe('fog range against the map it is tuned for', () => {
  it("matches scene.js's recorded longest sightline", () => {
    // Coarser sampling than the original measurement, so allow a little
    // slack -- this is a drift alarm, not a re-derivation.
    expect(longestSightline()).toBeGreaterThan(FOG_RANGE.longestSightline * 0.9);
    expect(longestSightline()).toBeLessThan(FOG_RANGE.longestSightline * 1.1);
  });

  it('keeps fog open past the range where a bot must stay readable', () => {
    // Fog must not begin inside a typical engagement. Half the longest line
    // is a fair stand-in for that: the median standing position's own
    // longest view is well under it.
    expect(FOG_RANGE.near).toBeGreaterThan(FOG_RANGE.longestSightline / 2);
  });

  it('reaches full density beyond the longest line, so it is never solid in play', () => {
    // Fog saturating short of the longest sightline would render the far end
    // of that line as flat sky -- the wall there would vanish.
    expect(FOG_RANGE.far).toBeGreaterThan(FOG_RANGE.longestSightline);
  });

  it('does not push fog so far it stops contributing', () => {
    // The other failure direction: fog beyond every reachable line of sight
    // is fog the player never sees.
    expect(FOG_RANGE.far).toBeLessThan(FOG_RANGE.longestSightline * 2);
  });
});
