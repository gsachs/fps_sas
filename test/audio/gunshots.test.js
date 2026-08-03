import { describe, expect, it } from 'vitest';
import { audioContextAction, nextVariantIndex } from '../../src/audio/gunshots.js';

// The audio context and THREE's Audio nodes need a real browser, so what is
// tested here is the logic that fails *silently* in one: a stuck context
// (no sound at all) and a variant picker that repeats (fire that sounds like
// a buzzer). Both look identical to "audio was never wired up".

describe('nextVariantIndex', () => {
  it('never repeats the sample just played', () => {
    for (let previous = 0; previous < 3; previous++) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(nextVariantIndex(previous, 3, roll)).not.toBe(previous);
      }
    }
  });

  it('can reach every variant across the range of rolls', () => {
    const reachable = new Set();
    for (let previous = 0; previous < 3; previous++) {
      for (const roll of [0, 0.5, 0.999]) reachable.add(nextVariantIndex(previous, 3, roll));
    }
    expect(reachable).toEqual(new Set([0, 1, 2]));
  });

  it('can pick any variant on the first shot, when nothing has played yet', () => {
    expect(nextVariantIndex(-1, 3, 0)).toBe(0);
    expect(nextVariantIndex(-1, 3, 0.5)).toBe(1);
    expect(nextVariantIndex(-1, 3, 0.999)).toBe(2);
  });

  it('stays in range at the top of the roll', () => {
    for (const count of [1, 2, 3, 5]) {
      for (let previous = -1; previous < count; previous++) {
        const index = nextVariantIndex(previous, count, 1);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
      }
    }
  });

  it('has nowhere to go with a single sample', () => {
    expect(nextVariantIndex(0, 1, 0.9)).toBe(0);
  });
});

describe('audioContextAction', () => {
  it('resumes a suspended context when the game is running', () => {
    expect(audioContextAction('suspended', true)).toBe('resume');
  });

  it('suspends a running context when the game is not', () => {
    expect(audioContextAction('running', false)).toBe('suspend');
  });

  it('does nothing when the context already matches the run state', () => {
    expect(audioContextAction('running', true)).toBeNull();
    expect(audioContextAction('suspended', false)).toBeNull();
  });
});
