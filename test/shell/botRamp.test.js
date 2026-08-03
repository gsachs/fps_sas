import { describe, expect, it } from 'vitest';
import { getActiveBotCount, buildOccupiedPositions } from '../../src/shell/botRamp.js';

describe('getActiveBotCount', () => {
  it('starts below the full bot count at match start', () => {
    expect(getActiveBotCount(0, 4)).toBeLessThan(4);
    expect(getActiveBotCount(0, 4)).toBeGreaterThan(0);
  });

  it('unlocks more bots as the match goes on', () => {
    const early = getActiveBotCount(1, 4);
    const later = getActiveBotCount(45, 4);
    expect(later).toBeGreaterThan(early);
  });

  it('never exceeds maxBots no matter how long the match runs', () => {
    expect(getActiveBotCount(10_000, 4)).toBe(4);
  });
});

describe('buildOccupiedPositions', () => {
  it('includes every live entity except the excluded one', () => {
    const entities = [
      { id: 'player', dead: false, position: { x: 1, y: 1, z: 1 } },
      { id: 'bot0', dead: false, position: { x: 2, y: 1, z: 2 } },
      { id: 'bot1', dead: false, position: { x: 3, y: 1, z: 3 } },
    ];
    expect(buildOccupiedPositions(entities, 'bot1')).toEqual([
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 1, z: 2 },
    ]);
  });

  it('excludes dead entities', () => {
    const entities = [
      { id: 'player', dead: false, position: { x: 1, y: 1, z: 1 } },
      { id: 'bot0', dead: true, position: { x: 2, y: 1, z: 2 } },
    ];
    expect(buildOccupiedPositions(entities, 'nobody')).toEqual([{ x: 1, y: 1, z: 1 }]);
  });

  it('includes the player, so a reinforcement cannot spawn on top of them (regression)', () => {
    // The bug this closes: filtering to "active bots only" omitted the
    // player entirely, so pickSpawnPoint's collision check never saw the
    // player and could return the player's own position.
    const entities = [
      { id: 'player', dead: false, position: { x: 20, y: 1, z: 20 } },
      { id: 'bot0', dead: false, position: { x: -20, y: 1, z: 20 } },
    ];
    expect(buildOccupiedPositions(entities, 'bot1')).toContainEqual({ x: 20, y: 1, z: 20 });
  });
});
