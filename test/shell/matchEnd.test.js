import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { checkMatchEnd, resetMatch, KILLS_TO_WIN } from '../../src/shell/matchEnd.js';

await RAPIER.init();

function buildFlatRapierWorld() {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
  rapierWorld.step(); // index the floor collider before any LOS raycast queries it
  return rapierWorld;
}

function makeEntity(id, score) {
  return { id, score, health: 100, dead: false, position: { x: 0, y: 1, z: 0 }, animHint: 'idle' };
}

function makeArmedEntity(id, overrides = {}) {
  return {
    id,
    score: 3,
    health: 40,
    dead: false,
    position: { x: 1, y: 1, z: 1 },
    animHint: 'idle',
    heldWeapon: 'machinegun',
    grenadeCount: 2,
    ...overrides,
  };
}

function createFakeEntityAccessor(entities) {
  const map = new Map(entities.map((e) => [e.id, e]));
  return { getEntity: (id) => map.get(id), allEntities: () => Array.from(map.values()) };
}

describe('checkMatchEnd', () => {
  it('is not ended while no one has reached the kill target', () => {
    const accessor = createFakeEntityAccessor([makeEntity('a', 3), makeEntity('b', 1)]);
    expect(checkMatchEnd(accessor).ended).toBe(false);
  });

  it('ends once the leader reaches the kill target, with a ranked leaderboard', () => {
    const accessor = createFakeEntityAccessor([makeEntity('a', KILLS_TO_WIN), makeEntity('b', 4)]);
    const result = checkMatchEnd(accessor);
    expect(result.ended).toBe(true);
    expect(result.leaderboard[0]).toEqual({ id: 'a', score: KILLS_TO_WIN });
  });
});

describe('resetMatch', () => {
  it('resets health, dead, score, and position for every entity, and clears respawn timers', () => {
    const entities = [
      { id: 'a', score: 5, health: 0, dead: true, position: { x: 1, y: 1, z: 1 }, animHint: 'dead' },
      { id: 'b', score: 2, health: 40, dead: false, position: { x: 2, y: 1, z: 2 }, animHint: 'idle' },
    ];
    const accessor = createFakeEntityAccessor(entities);
    const rapierWorld = buildFlatRapierWorld();
    const spawnPoints = [
      { x: 10, y: 1, z: 10 },
      { x: -10, y: 1, z: -10 },
    ];
    const teleportCalls = [];
    const movementSystem = { teleport: (id, pos) => teleportCalls.push({ id, pos }) };
    const clearedTimers = [];
    const healthSystem = { clearRespawnTimer: (id) => clearedTimers.push(id) };

    resetMatch(accessor, { rapierWorld, spawnPoints, movementSystem, healthSystem });

    for (const entity of entities) {
      expect(entity.health).toBe(100);
      expect(entity.dead).toBe(false);
      expect(entity.score).toBe(0);
      expect(entity.animHint).toBe('idle');
    }
    expect(teleportCalls).toHaveLength(2);
    expect(clearedTimers.sort()).toEqual(['a', 'b']);
  });

  it('assigns entities to distinct spawns rather than stacking them (occupied list threads across entities)', () => {
    const entities = [makeEntity('a', 0), makeEntity('b', 0)];
    const accessor = createFakeEntityAccessor(entities);
    const rapierWorld = buildFlatRapierWorld();
    const spawnPoints = [
      { x: 10, y: 1, z: 10 },
      { x: -10, y: 1, z: -10 },
    ];
    const teleportCalls = [];
    const movementSystem = { teleport: (id, pos) => teleportCalls.push({ id, pos }) };
    const healthSystem = { clearRespawnTimer: () => {} };

    resetMatch(accessor, { rapierWorld, spawnPoints, movementSystem, healthSystem });

    expect(teleportCalls).toHaveLength(2);
    // The second entity's placement must have seen the first as occupied --
    // otherwise both would land on the same (first) spawn point.
    expect(teleportCalls[0].pos).not.toEqual(teleportCalls[1].pos);
  });

  // AE4/R8 (U3's slice): every entity reverts to the default weapon with an
  // empty grenade pocket, and every pickup is restored -- asserted through
  // resetMatch directly, extended with a fake pickupSystem the same way the
  // existing tests fake movementSystem/healthSystem.
  it('reverts every entity to the default weapon, empties the grenade pocket, and restores all pickups (AE4)', () => {
    const entities = [makeArmedEntity('a'), makeArmedEntity('b', { grenadeCount: 3 })];
    const accessor = createFakeEntityAccessor(entities);
    const rapierWorld = buildFlatRapierWorld();
    const spawnPoints = [
      { x: 10, y: 1, z: 10 },
      { x: -10, y: 1, z: -10 },
    ];
    const movementSystem = { teleport: () => {} };
    const healthSystem = { clearRespawnTimer: () => {} };
    let resetAllCalls = 0;
    const pickupSystem = { resetAll: () => { resetAllCalls += 1; } };

    resetMatch(accessor, { rapierWorld, spawnPoints, movementSystem, healthSystem, pickupSystem });

    expect(resetAllCalls).toBe(1); // called once, not per-entity
    for (const entity of entities) {
      expect(entity.heldWeapon).toBe('machinegun');
      expect(entity.grenadeCount).toBe(0);
    }
  });

  // The killfeed only ages its entries while a match plays, so without an
  // explicit reset hook a restarted match would open showing the previous
  // match's frozen kill lines -- same rationale as pickupSystem/grenadeSystem
  // above, asserted the same way with a fake killfeed.
  it('clears the killfeed on restart, so a new match opens with an empty feed', () => {
    const entities = [makeEntity('a', 0)];
    const accessor = createFakeEntityAccessor(entities);
    const rapierWorld = buildFlatRapierWorld();
    const spawnPoints = [{ x: 10, y: 1, z: 10 }];
    const movementSystem = { teleport: () => {} };
    const healthSystem = { clearRespawnTimer: () => {} };
    let resetAllCalls = 0;
    const killfeed = { resetAll: () => { resetAllCalls += 1; } };

    resetMatch(accessor, { rapierWorld, spawnPoints, movementSystem, healthSystem, killfeed });

    expect(resetAllCalls).toBe(1);
  });

  // U4/R5: decals persist through a match under a cap, but a fresh match
  // must open with a clean surface -- same rationale/pattern as
  // killfeed/pickupSystem/grenadeSystem above, exercised through the real
  // reset path (not a direct decals.resetAll() call) so a wiring regression
  // of the killfeed-bug shape would be caught here too.
  it('clears the decal pool on restart', () => {
    const entities = [makeEntity('a', 0)];
    const accessor = createFakeEntityAccessor(entities);
    const rapierWorld = buildFlatRapierWorld();
    const spawnPoints = [{ x: 10, y: 1, z: 10 }];
    const movementSystem = { teleport: () => {} };
    const healthSystem = { clearRespawnTimer: () => {} };
    let resetAllCalls = 0;
    const decals = { resetAll: () => { resetAllCalls += 1; } };

    resetMatch(accessor, { rapierWorld, spawnPoints, movementSystem, healthSystem, decals });

    expect(resetAllCalls).toBe(1);
  });

  it('still resets health/dead/score/position without a pickupSystem (back-compat)', () => {
    const entities = [makeEntity('a', 5)];
    const accessor = createFakeEntityAccessor(entities);
    const rapierWorld = buildFlatRapierWorld();
    const spawnPoints = [{ x: 10, y: 1, z: 10 }];
    const movementSystem = { teleport: () => {} };
    const healthSystem = { clearRespawnTimer: () => {} };

    expect(() =>
      resetMatch(accessor, { rapierWorld, spawnPoints, movementSystem, healthSystem })
    ).not.toThrow();
    expect(entities[0].score).toBe(0);
  });
});
