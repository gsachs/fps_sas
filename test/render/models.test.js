import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D, loadCharacterModel, loadPropModel } from '../../src/render/models.js';

// No URL scheme this loader can resolve -- fails fast and deterministically
// (GLTFLoader's fetch rejects synchronously with "Failed to parse URL"),
// without needing a real server or a mocked loader. Each test below gets its
// own distinct unresolvable URL, not a shared constant: since #14 (loadGltf
// no longer caches a failure forever), a second real load for the very same
// URL is a genuine retry -- and retrying a URL whose failure was a
// synchronous "Failed to parse URL" throw trips an unrelated bookkeeping bug
// in three's FileLoader (its internal in-flight-request map never gets
// cleaned up for a request that failed before fetch() started), which hangs
// forever instead of failing again. Distinct URLs per test sidestep that
// three-internal quirk without masking it.
const UNRESOLVABLE_CHARACTER_URL = 'this-character-path-does-not-resolve.glb';
const UNRESOLVABLE_PROP_URL = 'this-prop-path-does-not-resolve.glb';

describe('loadCharacterModel (never returns null on failure)', () => {
  it('resolves a self-describing failure object and calls onError', async () => {
    const onError = vi.fn();

    const result = await loadCharacterModel(UNRESOLVABLE_CHARACTER_URL, { onError });

    expect(result).not.toBeNull();
    expect(result).toEqual({ scene: null, animations: [], loaded: false });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('loadPropModel (never returns null on failure)', () => {
  it('resolves a self-describing failure object and calls onError', async () => {
    const onError = vi.fn();

    const result = await loadPropModel(UNRESOLVABLE_PROP_URL, { onError });

    expect(result).not.toBeNull();
    expect(result).toEqual({ scene: null, loaded: false });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('loadGltf cache (U14: a failed load must not be cached forever)', () => {
  it('re-attempts the load on a later call for the same URL, and still caches a successful load', async () => {
    // Isolate this test's module graph so mocking GLTFLoader here can't leak
    // into the other tests in this file, which rely on the real loader.
    vi.resetModules();

    const load = vi.fn();
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: vi.fn().mockImplementation(() => ({ load })),
    }));

    const { loadPropModel } = await import('../../src/render/models.js');
    const url = 'flaky-model.glb';
    const onError = vi.fn();

    // First call: the underlying loader fails (transient network error).
    load.mockImplementationOnce((_url, _onLoad, _onProgress, onLoadError) => {
      onLoadError(new Error('network blip'));
    });
    const firstResult = await loadPropModel(url, { onError });
    expect(firstResult).toEqual({ scene: null, loaded: false });
    expect(onError).toHaveBeenCalledTimes(1);

    // Second call, same URL: the underlying loader now succeeds. A cache
    // that keeps the rejected promise forever would never call `load`
    // again and would just replay the first failure.
    const clonedScene = { cloned: true };
    const scene = { clone: () => clonedScene };
    load.mockImplementationOnce((_url, onLoad) => {
      onLoad({ scene, animations: [] });
    });
    const secondResult = await loadPropModel(url, { onError });

    expect(load).toHaveBeenCalledTimes(2);
    expect(secondResult).toEqual({ scene: clonedScene, loaded: true });
    expect(onError).toHaveBeenCalledTimes(1);

    // Third call, same URL: a successful load must still be cached -- this
    // must NOT call the underlying loader a third time.
    const thirdResult = await loadPropModel(url, { onError });
    expect(load).toHaveBeenCalledTimes(2);
    expect(thirdResult).toEqual({ scene: clonedScene, loaded: true });

    vi.doUnmock('three/addons/loaders/GLTFLoader.js');
    vi.resetModules();
  });
});

describe('disposeObject3D', () => {
  it('disposes geometry and material on every mesh in the hierarchy', () => {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');

    disposeObject3D(group);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes any texture referenced by a material', () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);

    const textureDispose = vi.spyOn(texture, 'dispose');

    disposeObject3D(mesh);

    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it('handles an array of materials (multi-material mesh)', () => {
    const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials);
    const disposeSpies = materials.map((m) => vi.spyOn(m, 'dispose'));

    disposeObject3D(mesh);

    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a node with no geometry or material (e.g. a Group)', () => {
    const group = new THREE.Group();
    group.add(new THREE.Group());
    expect(() => disposeObject3D(group)).not.toThrow();
  });
});
