import { describe, expect, it } from 'vitest';
import { checkMatchEnd, resetMatch, KILLS_TO_WIN } from '../../src/shell/matchEnd.js';

function makeEntity(id, score) {
  return { id, score, health: 100, dead: false, position: { x: 0, y: 1, z: 0 }, animHint: 'idle' };
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
    const spawnPoints = [
      { x: 10, y: 1, z: 10 },
      { x: -10, y: 1, z: -10 },
    ];
    const pickSpawnPoint = (points, occupied) => points[occupied.length % points.length];
    const teleportCalls = [];
    const movementSystem = { teleport: (id, pos) => teleportCalls.push({ id, pos }) };
    const clearedTimers = [];
    const healthSystem = { clearRespawnTimer: (id) => clearedTimers.push(id) };

    resetMatch(accessor, { spawnPoints, pickSpawnPoint, movementSystem, healthSystem });

    for (const entity of entities) {
      expect(entity.health).toBe(100);
      expect(entity.dead).toBe(false);
      expect(entity.score).toBe(0);
      expect(entity.animHint).toBe('idle');
    }
    expect(teleportCalls).toHaveLength(2);
    expect(clearedTimers.sort()).toEqual(['a', 'b']);
  });

  it('threads a shared occupied list across entities so spawns are assigned distinctly', () => {
    const entities = [makeEntity('a', 0), makeEntity('b', 0)];
    const accessor = createFakeEntityAccessor(entities);
    const spawnPoints = [
      { x: 10, y: 1, z: 10 },
      { x: -10, y: 1, z: -10 },
    ];
    const seenOccupiedLengths = [];
    const pickSpawnPoint = (points, occupied) => {
      seenOccupiedLengths.push(occupied.length);
      return points[occupied.length % points.length];
    };
    const movementSystem = { teleport: () => {} };
    const healthSystem = { clearRespawnTimer: () => {} };

    resetMatch(accessor, { spawnPoints, pickSpawnPoint, movementSystem, healthSystem });

    expect(seenOccupiedLengths).toEqual([0, 1]); // the second call sees the first spawn as occupied
  });
});
