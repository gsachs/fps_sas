import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selectSpawnPoint } from '../../src/arena/spawnPlacement.js';
import { createArena } from '../../src/arena/arena.js';
import { ROOMS } from '../../src/arena/layout.js';

await RAPIER.init();

// A wide wall splitting the world in two along z=0 -- points on the same
// side as the enemy are visible; points on the far side are occluded.
function buildSplitWorld() {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 2, 0.5).setTranslation(0, 1, 0));
  rapierWorld.step();
  return rapierWorld;
}

describe('selectSpawnPoint (R11, KTD7)', () => {
  it('covers AE3: chooses the one spawn point out of the enemy line of sight', () => {
    const rapierWorld = buildSplitWorld();
    const visible = { x: 0, y: 1, z: 5 }; // same side as the enemy
    const hidden = { x: 0, y: 1, z: -5 }; // behind the wall
    const enemy = { x: 0, y: 1, z: 8 };

    const chosen = selectSpawnPoint(rapierWorld, [visible, hidden], { enemyPositions: [enemy] });
    expect(chosen).toEqual(hidden);
  });

  it('covers AE3 fallback: when every point is visible, the one visible to fewest enemies wins', () => {
    // A wall spanning only x in [15,25] at z=0: it sits on the straight
    // line from enemyA to seenByOne (crossing z=0 at x=20, dead centre of
    // the wall) but nowhere near the line to seenByBoth (crossing at x=0),
    // so enemyA sees exactly one of the two candidates. enemyB is far
    // enough from the wall to see both regardless -- verified directly
    // against hasLineOfSight before writing this test, since a wall's
    // effect on a specific line pair is easy to get wrong by eyeballing it.
    const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0));
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(5, 2, 0.5).setTranslation(20, 1, 0));
    rapierWorld.step();

    const seenByBoth = { x: 0, y: 1, z: -10 };
    const seenByOneOnly = { x: 40, y: 1, z: -10 };
    const enemyA = { x: 0, y: 1, z: 10 }; // sees seenByBoth; the wall blocks its line to seenByOneOnly
    const enemyB = { x: 100, y: 1, z: 100 }; // far from the wall -- sees both regardless

    const chosen = selectSpawnPoint(rapierWorld, [seenByBoth, seenByOneOnly], {
      enemyPositions: [enemyA, enemyB],
    });
    expect(chosen).toEqual(seenByOneOnly); // 1 observer beats 2
  });

  it('regression: the fallback branch still respects occupied-position spacing, not just fewest-observers', () => {
    // Same wall as the fewest-observers test, plus a second point (x=35)
    // that lands in the same "1 observer" tier as seenByOneOnly (x=40) --
    // verified directly against hasLineOfSight before writing this test.
    // The fallback branch used to pick purely by observer count/distance
    // with no occupied-position check at all, so it could return a point
    // sitting exactly on another live entity -- silently reopening the
    // spawn-on-top-of-someone bug class this file exists to close, just
    // through this second code path instead of the original one (found by
    // adversarial code review).
    const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0));
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(5, 2, 0.5).setTranslation(20, 1, 0));
    rapierWorld.step();

    const seenByBoth = { x: 0, y: 1, z: -10 }; // 2 observers
    const occupiedSafeSpot = { x: 40, y: 1, z: -10 }; // 1 observer, but already occupied
    const otherSafeSpot = { x: 35, y: 1, z: -10 }; // also 1 observer, unoccupied
    const enemyA = { x: 0, y: 1, z: 10 };
    const enemyB = { x: 100, y: 1, z: 100 };

    const chosen = selectSpawnPoint(rapierWorld, [seenByBoth, occupiedSafeSpot, otherSafeSpot], {
      enemyPositions: [enemyA, enemyB],
      occupiedPositions: [occupiedSafeSpot],
    });
    expect(chosen).toEqual(otherSafeSpot); // fewest observers AND not stacked on someone
  });

  it('breaks a fewest-observers tie by distance to the nearest observer', () => {
    const rapierWorld = buildSplitWorld();
    const near = { x: 1, y: 1, z: 5 };
    const far = { x: 10, y: 1, z: 5 };
    const enemy = { x: 0, y: 1, z: 5 }; // same side as both -- both visible, one tied observer count each

    const chosen = selectSpawnPoint(rapierWorld, [near, far], { enemyPositions: [enemy] });
    expect(chosen).toEqual(far); // farther from the one enemy that can see it
  });

  it('regression: never picks a candidate sitting exactly on a living enemy when a safer one exists (the historical ramp-activation bug)', () => {
    const rapierWorld = buildSplitWorld();
    const onEnemy = { x: 0, y: 1, z: 8 }; // exactly the enemy's own position
    const safe = { x: 0, y: 1, z: -5 };
    const enemy = { x: 0, y: 1, z: 8 };

    const chosen = selectSpawnPoint(rapierWorld, [onEnemy, safe], { enemyPositions: [enemy] });
    expect(chosen).toEqual(safe);
  });

  it('falls back to plain occupied-position selection when there are no living enemies to hide from', () => {
    const rapierWorld = buildSplitWorld();
    const a = { x: 0, y: 1, z: 5 };
    const b = { x: 0, y: 1, z: -5 };
    const chosen = selectSpawnPoint(rapierWorld, [a, b], { enemyPositions: [], occupiedPositions: [a] });
    expect(chosen).toEqual(b); // still respects the occupied-position spacing rule
  });

  it('never returns null or undefined, even with only one spawn point and enemies everywhere', () => {
    const rapierWorld = buildSplitWorld();
    const only = { x: 0, y: 1, z: 5 };
    const chosen = selectSpawnPoint(rapierWorld, [only], { enemyPositions: [{ x: 0, y: 1, z: 5.1 }] });
    expect(chosen).toEqual(only);
  });

  it('throws rather than returning null when no spawn points are configured', () => {
    const rapierWorld = buildSplitWorld();
    expect(() => selectSpawnPoint(rapierWorld, [], { enemyPositions: [{ x: 0, y: 1, z: 0 }] })).toThrow();
  });
});

describe('spawns.js stays physics-free (KTD7)', () => {
  it('pickSpawnPoint takes no Rapier world and performs no physics query', async () => {
    const module = await import('../../src/arena/spawns.js');
    const chosen = module.pickSpawnPoint([{ x: 0, y: 1, z: 0 }], []);
    expect(chosen).toEqual({ x: 0, y: 1, z: 0 }); // runs to completion with zero physics inputs at all
  });
});

describe('selectSpawnPoint: match start places no two entities in mutual view (R11, real arena)', () => {
  it('sequential placement across the shipped layout yields pairwise-unobstructed spawns', () => {
    const arena = createArena();
    arena.rapierWorld.step();

    const placed = [];
    // Same shape as main.js's match-start loop: player + a few bots, each
    // placed out of every already-placed entity's sight in turn.
    for (let i = 0; i < 5; i++) {
      const spawn = selectSpawnPoint(arena.rapierWorld, arena.spawnPoints, {
        enemyPositions: placed,
        occupiedPositions: placed,
      });
      placed.push(spawn);
    }

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const dx = placed[j].x - placed[i].x;
        const dz = placed[j].z - placed[i].z;
        const distance = Math.hypot(dx, dz);
        const direction = { x: dx / distance, y: 0, z: dz / distance };
        const origin = { x: placed[i].x, y: placed[i].y + 0.6, z: placed[i].z };
        const hit = arena.rapierWorld.castRay(new RAPIER.Ray(origin, direction), distance, true);
        expect(hit).not.toBeNull(); // blocked -- not mutually visible
      }
    }
  });
});

describe('ROOMS sanity (used above)', () => {
  it('the shipped layout has at least 5 rooms to place into', () => {
    expect(ROOMS.length).toBeGreaterThanOrEqual(5);
  });
});
