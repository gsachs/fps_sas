import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { seek, flee, wander, avoidObstacles } from '../../../src/sim/bot/steering.js';

await RAPIER.init();

function dot(a, b) {
  return a.x * b.x + a.z * b.z;
}

describe('seek', () => {
  it('returns a unit vector toward the target', () => {
    const direction = seek({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 });
    expect(direction.x).toBeCloseTo(0);
    expect(direction.z).toBeCloseTo(1);
  });

  it('returns zero rather than NaN when already at the target', () => {
    const direction = seek({ x: 2, y: 1, z: 3 }, { x: 2, y: 1, z: 3 });
    expect(direction).toEqual({ x: 0, z: 0 });
  });
});

describe('flee', () => {
  it('is the exact negation of seek toward the same point', () => {
    const from = { x: 1, y: 1, z: 1 };
    const away = { x: 4, y: 1, z: 5 };
    const fleeDirection = flee(from, away);
    const seekDirection = seek(from, away);
    expect(fleeDirection.x).toBeCloseTo(-seekDirection.x);
    expect(fleeDirection.z).toBeCloseTo(-seekDirection.z);
  });
});

describe('wander', () => {
  it('drifts yaw by at most the fixed jitter bound in one call', () => {
    const result = wander(0, () => 1); // worst-case jitter roll
    expect(Math.abs(result.yaw)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('returns a unit-length direction matching the drifted yaw', () => {
    const result = wander(0.4, () => 0.5);
    expect(Math.hypot(result.x, result.z)).toBeCloseTo(1);
    expect(result.x).toBeCloseTo(Math.sin(result.yaw));
    expect(result.z).toBeCloseTo(Math.cos(result.yaw));
  });
});

// A wide wall directly ahead in +Z, matching the shape of the arena's own
// cover boxes -- wide and tall enough that the ray always lands on its flat
// front face, never an edge/corner, so the hit normal is cleanly (0, 0, -1).
function buildWorldWithWallAhead() {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, 0.5).setTranslation(0, 1, 5));
  // Rapier's broad-phase only indexes a newly-created collider on the next
  // world.step() -- a query cast before any step ran can miss it entirely.
  rapierWorld.step();
  return rapierWorld;
}

describe('avoidObstacles', () => {
  it('returns the desired direction unchanged when the path ahead is clear', () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const desired = { x: 0, z: 1 };
    const result = avoidObstacles(rapierWorld, { x: 0, y: 1, z: 0 }, desired, undefined);
    expect(result).toEqual(desired);
  });

  it('does not reverse a head-on approach into the obstacle (regression)', () => {
    const rapierWorld = buildWorldWithWallAhead();
    const desired = { x: 0, z: 1 }; // straight at the wall
    const result = avoidObstacles(rapierWorld, { x: 0, y: 1, z: 3 }, desired, undefined);

    // The bug: normalize(desired + normal * 1.5) with normal roughly
    // opposite desired collapses close to -desired (dot ~= -1), sending
    // the bot back the way it came instead of past the obstacle. A correct
    // deflection keeps at least a perpendicular (dot ~= 0) response for
    // the exact head-on case -- clearly distinguishable from a reversal.
    expect(dot(result, desired)).toBeGreaterThan(-0.5);
  });

  it('deflects an oblique approach with genuine forward progress, not a reversal (regression)', () => {
    const rapierWorld = buildWorldWithWallAhead();
    const fromPosition = { x: -1.5, y: 1, z: 3 };
    const desired = seek(fromPosition, { x: 0, y: 1, z: 5 });
    const result = avoidObstacles(rapierWorld, fromPosition, desired, undefined);

    // Unlike the exact head-on case, an oblique approach has room to slide
    // sideways past the obstacle while still closing on the target -- a
    // correct deflection makes real forward progress (dot > 0). The old
    // normal-blend formula reversed this case too (measured dot ~= -0.22).
    expect(dot(result, desired)).toBeGreaterThan(0);
  });
});
