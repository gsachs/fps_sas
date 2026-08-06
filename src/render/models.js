import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';
import { raceInitWithTimeout } from '../shell/initTimeout.js';

// Loads a GLTF model, caching the parsed result so multiple instances
// (e.g. several bots) clone cheaply via SkeletonUtils rather than
// re-fetching. A failed load calls onError and never throws or hangs --
// callers keep their placeholder mesh in that case (R9 error path). Only a
// successful load is cached: a failure is evicted immediately (U14) so a
// transient error (network blip, asset briefly unavailable) gets retried on
// the next call instead of failing the same URL for the rest of the session.
// U29: a stalled connection calls neither GLTFLoader's onLoad nor its
// onError, so the raw load promise would sit pending forever -- U14's
// eviction .catch never runs (it only runs on rejection) and no retry is
// ever possible. Racing the load against the same timeout used for RAPIER's
// init (raceInitWithTimeout) turns "never settles" into a rejection, which
// then flows through the existing eviction .catch below exactly like any
// other load error.
const loader = new GLTFLoader();
const gltfCache = new Map(); // url -> Promise<GLTF>

function loadGltf(url) {
  if (!gltfCache.has(url)) {
    gltfCache.set(
      url,
      raceInitWithTimeout(
        () =>
          new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
          })
      ).catch((error) => {
        // Never cache a failure: a transient error (network blip, asset
        // briefly unavailable) shouldn't doom every later request for this
        // URL for the rest of the session. Evict so the next call retries.
        gltfCache.delete(url);
        throw error;
      })
    );
  }
  return gltfCache.get(url);
}

// Resolves to { scene, animations, loaded } with a fresh, independently-
// posable clone of the model -- safe to add multiple instances of the same
// GLTF to a scene (each bot gets its own clone; the underlying geometry/
// texture data is shared, not duplicated). Never rejects and never resolves
// null (Core Invariant): on load failure resolves a self-describing
// { scene: null, animations: [], loaded: false } instead, and onError(error)
// is called for the caller's own logging/handling. Check `loaded`, not
// truthiness -- the failure value is itself a truthy object.
export function loadCharacterModel(url, { onError } = {}) {
  return loadGltf(url)
    .then((gltf) => ({ scene: cloneSkinnedScene(gltf.scene), animations: gltf.animations, loaded: true }))
    .catch((error) => {
      onError?.(error);
      return { scene: null, animations: [], loaded: false };
    });
}

// Static (non-skinned) prop model, e.g. the first-person weapon view.
// Independent instances still need geometry disposed independently if
// ever replaced, but do not need SkeletonUtils cloning. Same never-null
// contract as loadCharacterModel: check `loaded`, not truthiness.
export function loadPropModel(url, { onError } = {}) {
  return loadGltf(url)
    .then((gltf) => ({ scene: gltf.scene.clone(), loaded: true }))
    .catch((error) => {
      onError?.(error);
      return { scene: null, loaded: false };
    });
}

// Frees GPU resources for an Object3D and everything under it -- geometry,
// materials, and any textures a material references. Call when a mesh is
// removed from the scene and won't be reused (e.g. swapping a placeholder
// for a loaded model).
export function disposeObject3D(object) {
  object.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}
