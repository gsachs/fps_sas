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

  // U5's retuned baseline (live play found the KTD6 first pass's initial 3
  // too crowded an opening), checked at representative elapsed times -- 2
  // initial, unlocking one more bot every 15s, capped at the new 6-bot max.
  it('yields the retuned baseline values at representative elapsed times for the six-bot roster', () => {
    expect(getActiveBotCount(0, 6)).toBe(2);
    expect(getActiveBotCount(14, 6)).toBe(2); // just under the first interval
    expect(getActiveBotCount(15, 6)).toBe(3);
    expect(getActiveBotCount(30, 6)).toBe(4);
    expect(getActiveBotCount(45, 6)).toBe(5);
    expect(getActiveBotCount(60, 6)).toBe(6);
    expect(getActiveBotCount(200, 6)).toBe(6); // capped, well past every interval
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
