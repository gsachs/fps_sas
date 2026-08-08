// The one graphics quality knob the player can turn, plus the memory of what
// they chose. Shadow-map resolution earns a setting rather than a constant
// because its right answer genuinely depends on the machine: the shadow
// camera's box is sized from the arena (render/scene.js), so this map's box
// spends its texels over 121 world units. Holding the crisp edge density the
// retired, smaller arena had at 2048 costs a 4096 map -- four times the
// texture memory and fill. That is nothing on a modern discrete GPU and very
// much something on integrated graphics, so High is the default and Standard
// is there for the machines that need it.
//
// Kept out of scene.js so the resolution and persistence rules are testable
// without a WebGL context or a real browser: scene.js is handed the resolved
// value and never reads storage itself.

const STORAGE_KEY = 'fps-arena.shadow-quality';

export const SHADOW_QUALITY = { HIGH: 'high', STANDARD: 'standard' };

export const DEFAULT_SHADOW_QUALITY = SHADOW_QUALITY.HIGH;

// 4096 over this arena's shadow box is ~34 texels per world unit, a shade
// better than the retired arena's 2048 gave it; 2048 is ~17, visibly softer
// at a shadow's edge but entirely playable.
const SHADOW_MAP_SIZE_BY_QUALITY = {
  [SHADOW_QUALITY.HIGH]: 4096,
  [SHADOW_QUALITY.STANDARD]: 2048,
};

export function shadowMapSize(quality) {
  return SHADOW_MAP_SIZE_BY_QUALITY[quality] ?? SHADOW_MAP_SIZE_BY_QUALITY[DEFAULT_SHADOW_QUALITY];
}

export function otherShadowQuality(quality) {
  return quality === SHADOW_QUALITY.HIGH ? SHADOW_QUALITY.STANDARD : SHADOW_QUALITY.HIGH;
}

export function shadowQualityLabel(quality) {
  return quality === SHADOW_QUALITY.STANDARD ? 'Shadows: Standard' : 'Shadows: High';
}

// A store that discards writes and remembers nothing, returned instead of
// null when the real one is unreachable (Core Invariant) -- the setting then
// applies for the session and simply does not survive a reload.
const FORGETFUL_STORAGE = {
  getItem: () => null,
  setItem: () => {},
};

// Safari's private mode throws on `localStorage` access outright, and a
// sandboxed iframe can too -- reaching for it unguarded at module scope is
// enough to stop the game booting over a graphics preference.
export function browserStorage() {
  try {
    return globalThis.localStorage ?? FORGETFUL_STORAGE;
  } catch {
    return FORGETFUL_STORAGE;
  }
}

// Anything other than a value this module wrote -- absent, hand-edited, a
// quality name from a future version -- resolves to the default rather than
// reaching scene.js as an unknown.
export function readShadowQuality(storage) {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return stored === SHADOW_QUALITY.STANDARD || stored === SHADOW_QUALITY.HIGH
      ? stored
      : DEFAULT_SHADOW_QUALITY;
  } catch {
    return DEFAULT_SHADOW_QUALITY;
  }
}

export function writeShadowQuality(storage, quality) {
  try {
    storage.setItem(STORAGE_KEY, quality);
  } catch {
    // Out of quota, or a store that refuses writes. The choice still applies
    // to this session; only its persistence is lost.
  }
}
