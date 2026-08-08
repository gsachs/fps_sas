import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHADOW_QUALITY,
  SHADOW_QUALITY,
  browserStorage,
  otherShadowQuality,
  readShadowQuality,
  shadowMapSize,
  shadowQualityLabel,
  writeShadowQuality,
} from '../../src/shell/graphicsSettings.js';

// A store that behaves the way Safari's private mode does: throwing on the
// access itself rather than returning null.
const HOSTILE_STORAGE = {
  getItem() {
    throw new DOMException('The operation is insecure.');
  },
  setItem() {
    throw new DOMException('The operation is insecure.');
  },
};

function fakeStorage(initial = {}) {
  const values = { ...initial };
  return {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe('shadow quality resolution', () => {
  it('maps each quality to a distinct map size, High being the larger', () => {
    expect(shadowMapSize(SHADOW_QUALITY.HIGH)).toBeGreaterThan(shadowMapSize(SHADOW_QUALITY.STANDARD));
  });

  it('resolves an unknown quality to the default rather than undefined', () => {
    // A value from a future version, or a hand-edited one, must not reach
    // scene.js as an undefined map size -- three.js would take it literally.
    expect(shadowMapSize('ultra')).toBe(shadowMapSize(DEFAULT_SHADOW_QUALITY));
    expect(shadowMapSize(undefined)).toBe(shadowMapSize(DEFAULT_SHADOW_QUALITY));
  });

  it('toggles between exactly the two qualities', () => {
    expect(otherShadowQuality(SHADOW_QUALITY.HIGH)).toBe(SHADOW_QUALITY.STANDARD);
    expect(otherShadowQuality(SHADOW_QUALITY.STANDARD)).toBe(SHADOW_QUALITY.HIGH);
  });

  it('labels each quality distinctly so the button says which one is active', () => {
    expect(shadowQualityLabel(SHADOW_QUALITY.HIGH)).not.toBe(
      shadowQualityLabel(SHADOW_QUALITY.STANDARD)
    );
  });
});

describe('shadow quality persistence', () => {
  it('round-trips a written choice', () => {
    const storage = fakeStorage();
    writeShadowQuality(storage, SHADOW_QUALITY.STANDARD);
    expect(readShadowQuality(storage)).toBe(SHADOW_QUALITY.STANDARD);
  });

  it('defaults to High when nothing has been stored', () => {
    expect(readShadowQuality(fakeStorage())).toBe(SHADOW_QUALITY.HIGH);
  });

  it('defaults rather than trusting a stored value it did not write', () => {
    const storage = fakeStorage({ 'fps-arena.shadow-quality': 'potato' });
    expect(readShadowQuality(storage)).toBe(DEFAULT_SHADOW_QUALITY);
  });

  it('survives a storage that throws on access, and never returns null', () => {
    // The failure this guards: an unguarded localStorage read at module scope
    // stops the game booting over a graphics preference.
    expect(readShadowQuality(HOSTILE_STORAGE)).toBe(DEFAULT_SHADOW_QUALITY);
    expect(() => writeShadowQuality(HOSTILE_STORAGE, SHADOW_QUALITY.STANDARD)).not.toThrow();
  });

  it('hands back a usable store even where there is no localStorage at all', () => {
    const storage = browserStorage();
    expect(storage).not.toBeNull();
    expect(() => writeShadowQuality(storage, SHADOW_QUALITY.HIGH)).not.toThrow();
    expect(readShadowQuality(storage)).toBeTruthy();
  });
});
