import { describe, expect, it } from 'vitest';
import { getActiveBotCount } from '../../src/shell/botRamp.js';

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
