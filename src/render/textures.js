import * as THREE from 'three';
import { raceInitWithTimeout } from '../shell/initTimeout.js';

// Loads a tiling detail (albedo) texture for the arena's real-material pass
// (U3, R1/R2), caching the decoded image by URL so every caller sharing a
// URL reuses one decode instead of re-fetching it per material. Mirrors
// models.js's loadGltf contract: a load never rejects and never resolves
// null (Core Invariant) -- on failure it calls onError and resolves a
// self-describing { texture: null, loaded: false } fallback, so a caller
// (arenaMesh.js) can leave its material on its existing flat colour instead
// of a texture with no image data (placeholder-on-failure convention). A
// stalled connection is raced against the same init timeout GLTF loads use
// (U29) so a load that never calls back can't hang the caller forever
// either. Only a successful load is cached -- a failure is evicted (U14) so
// a transient error gets retried on the next call instead of failing the
// same URL for the rest of the session.
const loader = new THREE.TextureLoader();
const imageCache = new Map(); // url -> Promise<THREE.Texture> (image-bearing, unconfigured)

function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(
      url,
      raceInitWithTimeout(
        () =>
          new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
          })
      ).catch((error) => {
        imageCache.delete(url);
        throw error;
      })
    );
  }
  return imageCache.get(url);
}

// A conservative anisotropy cap most GPUs exceed comfortably. This module
// has no renderer reference to query the real device maximum against, and 8
// already reads visibly sharper at a grazing viewing angle (a corridor
// floor stretching to the horizon) than the default of 1 -- the tradeoff is
// a fixed cap instead of the device's true max, in exchange for not wiring
// a renderer handle through a loader that otherwise doesn't need one.
const ANISOTROPY = 8;

// Resolves { texture, loaded }. `texture` is a fresh instance per call (not
// the cached base image) with repeat wrapping, sRGB colour space, and
// anisotropy configured -- the settings a tiling albedo map always needs --
// so two callers sharing a URL but wanting different repeat counts (e.g. the
// arena floor vs. its walls) never fight over one shared Texture's repeat
// property. `repeat` should be measured against the real-world size of the
// surface it will tile across, not guessed -- see the caller's own
// measurement comment. Never rejects and never resolves null (Core
// Invariant): check `loaded`, not truthiness -- the failure value is itself
// a truthy object.
export function loadSurfaceTexture(url, { repeat = [1, 1], onError } = {}) {
  return loadImage(url)
    .then((baseTexture) => {
      const texture = baseTexture.clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat[0], repeat[1]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = ANISOTROPY;
      texture.needsUpdate = true;
      return { texture, loaded: true };
    })
    .catch((error) => {
      onError?.(error);
      return { texture: null, loaded: false };
    });
}
