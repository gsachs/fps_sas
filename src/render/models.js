import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';

// Loads a GLTF model, caching the parsed result so multiple instances
// (e.g. several bots) clone cheaply via SkeletonUtils rather than
// re-fetching. A failed load calls onError and never throws or hangs --
// callers keep their placeholder mesh in that case (R9 error path).
const loader = new GLTFLoader();
const gltfCache = new Map(); // url -> Promise<GLTF>

function loadGltf(url) {
  if (!gltfCache.has(url)) {
    gltfCache.set(
      url,
      new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
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
