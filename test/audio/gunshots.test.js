import { describe, expect, it } from 'vitest';
import {
  audioContextAction,
  nextVariantIndex,
  resolveSoundSet,
  pickVariantForSet,
  WEAPON_SOUND_SETS,
} from '../../src/audio/gunshots.js';

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

describe('resolveSoundSet (KTD8: named per-weapon sound sets)', () => {
  it('selects the machine-gun set by weapon id', () => {
    expect(resolveSoundSet('machinegun')).toBe('machinegun');
  });

  it('falls back to the pistol set for the pistol id, an unknown id, or no id at all', () => {
    expect(resolveSoundSet('pistol')).toBe('pistol');
    expect(resolveSoundSet('unknown-weapon')).toBe('pistol');
    expect(resolveSoundSet(undefined)).toBe('pistol');
  });

  it('gives the machine-gun set a distinct playback rate from the pistol (placeholder pitch until an asset lands)', () => {
    expect(WEAPON_SOUND_SETS.machinegun.playbackRate).not.toBe(WEAPON_SOUND_SETS.pistol.playbackRate);
  });
});

describe('pickVariantForSet', () => {
  it('tracks an independent cursor per set id, never repeating within the same set even when calls interleave', () => {
    const cursors = new Map();
    let lastPistol = null;
    let lastMg = null;
    for (let i = 0; i < 20; i++) {
      const pistolIndex = pickVariantForSet(cursors, 'pistol', 3, Math.random());
      if (lastPistol !== null) expect(pistolIndex).not.toBe(lastPistol);
      lastPistol = pistolIndex;

      const mgIndex = pickVariantForSet(cursors, 'machinegun', 3, Math.random());
      if (lastMg !== null) expect(mgIndex).not.toBe(lastMg);
      lastMg = mgIndex;
    }
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
