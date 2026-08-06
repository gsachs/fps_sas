import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_INIT_TIMEOUT_MS } from '../../src/shell/initTimeout.js';

// No document global in this suite's Node environment, so three's real
// ImageLoader (which unconditionally calls document.createElementNS) fails
// synchronously the moment .load() runs -- a real, deterministic failure with
// no mocking needed, exactly like models.test.js's UNRESOLVABLE_*_URL tests
// get a real (if different) failure from GLTFLoader's real fetch. Each test
// gets its own URL so a passing load never collides with a cached failure
// from an earlier test (same rationale as models.test.js).
describe('loadSurfaceTexture (never resolves null on failure)', () => {
  it('resolves a self-describing failure object and calls onError', async () => {
    const { loadSurfaceTexture } = await import('../../src/render/textures.js');
    const onError = vi.fn();

    const result = await loadSurfaceTexture('this-texture-path-does-not-resolve.jpg', { onError });

    expect(result).not.toBeNull();
    expect(result).toEqual({ texture: null, loaded: false });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('loadSurfaceTexture cache (mirrors U14: a failed load must not be cached forever)', () => {
  it('re-attempts the load on a later call for the same URL, and still caches a successful load', async () => {
    // Isolate this test's module graph so mocking 'three' here can't leak
    // into the other tests in this file, which rely on the real loader.
    vi.resetModules();

    const load = vi.fn();
    vi.doMock('three', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, TextureLoader: vi.fn().mockImplementation(() => ({ load })) };
    });

    const { loadSurfaceTexture } = await import('../../src/render/textures.js');
    const url = 'flaky-texture.jpg';
    const onError = vi.fn();

    // First call: the underlying loader fails (transient network error).
    load.mockImplementationOnce((_url, _onLoad, _onProgress, onLoadError) => {
      onLoadError(new Error('network blip'));
    });
    const firstResult = await loadSurfaceTexture(url, { onError });
    expect(firstResult).toEqual({ texture: null, loaded: false });
    expect(onError).toHaveBeenCalledTimes(1);

    // Second call, same URL: the underlying loader now succeeds. A cache
    // that keeps the rejected promise forever would never call `load` again
    // and would just replay the first failure.
    const baseTexture = new THREE.Texture();
    load.mockImplementationOnce((_url, onLoad) => {
      onLoad(baseTexture);
    });
    const secondResult = await loadSurfaceTexture(url, { onError });

    expect(load).toHaveBeenCalledTimes(2);
    expect(secondResult.loaded).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);

    // Third call, same URL: a successful load must still be cached -- this
    // must NOT call the underlying loader a third time.
    const thirdResult = await loadSurfaceTexture(url, { onError });
    expect(load).toHaveBeenCalledTimes(2);
    expect(thirdResult.loaded).toBe(true);

    vi.doUnmock('three');
    vi.resetModules();
  });
});

describe('loadSurfaceTexture configuration (on a successful load)', () => {
  it('configures repeat wrapping, sRGB colour space, and the requested repeat count', async () => {
    vi.resetModules();

    const load = vi.fn();
    vi.doMock('three', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, TextureLoader: vi.fn().mockImplementation(() => ({ load })) };
    });

    const { loadSurfaceTexture } = await import('../../src/render/textures.js');
    const baseTexture = new THREE.Texture();
    load.mockImplementationOnce((_url, onLoad) => onLoad(baseTexture));

    const { texture, loaded } = await loadSurfaceTexture('configured-texture.jpg', { repeat: [12, 7] });

    expect(loaded).toBe(true);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.repeat.x).toBe(12);
    expect(texture.repeat.y).toBe(7);
    // A clone, not the cached base instance -- two callers requesting
    // different repeat counts for the same URL must not fight over one
    // shared Texture's repeat property.
    expect(texture).not.toBe(baseTexture);

    vi.doUnmock('three');
    vi.resetModules();
  });

  it('gives each call its own texture instance so repeat settings never collide', async () => {
    vi.resetModules();

    const load = vi.fn();
    vi.doMock('three', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, TextureLoader: vi.fn().mockImplementation(() => ({ load })) };
    });

    const { loadSurfaceTexture } = await import('../../src/render/textures.js');
    const baseTexture = new THREE.Texture();
    load.mockImplementation((_url, onLoad) => onLoad(baseTexture));

    const url = 'shared-image-two-repeats.jpg';
    const [{ texture: wallTexture }, { texture: groundTexture }] = await Promise.all([
      loadSurfaceTexture(url, { repeat: [4, 4] }),
      loadSurfaceTexture(url, { repeat: [20, 20] }),
    ]);

    expect(wallTexture.repeat.x).toBe(4);
    expect(groundTexture.repeat.x).toBe(20);
    // The underlying image is only decoded once (the mocked loader's `load`
    // was only asked for this URL once) even though two configured
    // instances came out of it.
    expect(load).toHaveBeenCalledTimes(1);

    vi.doUnmock('three');
    vi.resetModules();
  });
});

describe('loadSurfaceTexture timeout (mirrors U29: a load that never settles must not hang forever)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out to the failure sentinel, calls onError, and still lets a later call retry', async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const load = vi.fn();
    vi.doMock('three', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, TextureLoader: vi.fn().mockImplementation(() => ({ load })) };
    });

    const { loadSurfaceTexture } = await import('../../src/render/textures.js');
    const url = 'stalled-texture.jpg';
    const onError = vi.fn();

    // The underlying loader never calls back at all -- the stalled
    // connection case this test targets.
    load.mockImplementationOnce(() => {});
    const firstResultPromise = loadSurfaceTexture(url, { onError });
    await vi.advanceTimersByTimeAsync(DEFAULT_INIT_TIMEOUT_MS);
    const firstResult = await firstResultPromise;

    expect(firstResult).toEqual({ texture: null, loaded: false });
    expect(onError).toHaveBeenCalledTimes(1);

    vi.doUnmock('three');
    vi.resetModules();
  });
});
