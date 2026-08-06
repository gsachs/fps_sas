import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { createPickupMeshes } from '../../src/render/pickupMeshes.js';
import { GRENADE_MODEL, MACHINEGUN_PICKUP_MODEL } from '../../src/render/modelAssets.js';

const FAKE_PICKUPS = [
  { id: 'pickup-mg-central', type: 'machinegun', x: 5, y: 1, z: 5, roomId: 'central' },
  { id: 'pickup-grenade-nw', type: 'grenade', x: -32, y: 1, z: 32, roomId: 'nw' },
];

describe('createPickupMeshes', () => {
  it('builds one persistent mesh per pickup descriptor, added to the scene once', () => {
    const scene = new THREE.Scene();
    createPickupMeshes(scene, FAKE_PICKUPS);

    expect(scene.children).toHaveLength(FAKE_PICKUPS.length);
  });

  it("positions each mesh at its pickup's world position", () => {
    const scene = new THREE.Scene();
    createPickupMeshes(scene, FAKE_PICKUPS);
    const [mgMesh, grenadeMesh] = scene.children;

    expect(mgMesh.position.x).toBe(5);
    expect(mgMesh.position.z).toBe(5);
    expect(grenadeMesh.position.x).toBe(-32);
    expect(grenadeMesh.position.z).toBe(32);
  });

  it('gives machine-gun and grenade pickups visually distinct colors (R5)', () => {
    const scene = new THREE.Scene();
    createPickupMeshes(scene, FAKE_PICKUPS);
    const [mgMesh, grenadeMesh] = scene.children;

    expect(mgMesh.material.color.getHex()).not.toBe(grenadeMesh.material.color.getHex());
  });

  it('every mesh starts visible', () => {
    const scene = new THREE.Scene();
    createPickupMeshes(scene, FAKE_PICKUPS);

    for (const mesh of scene.children) expect(mesh.visible).toBe(true);
  });

  it('update() toggles visibility by id -- the persistent-mesh idiom (KTD7), not pooling', () => {
    const scene = new THREE.Scene();
    const pickupMeshes = createPickupMeshes(scene, FAKE_PICKUPS);
    const [mgMesh, grenadeMesh] = scene.children;

    pickupMeshes.update([
      { id: 'pickup-mg-central', taken: true },
      { id: 'pickup-grenade-nw', taken: false },
    ]);
    expect(mgMesh.visible).toBe(false);
    expect(grenadeMesh.visible).toBe(true);

    // Same mesh instances, still in the scene -- respawn shows the mesh
    // again rather than creating a new one.
    expect(scene.children).toHaveLength(FAKE_PICKUPS.length);
    pickupMeshes.update([
      { id: 'pickup-mg-central', taken: false },
      { id: 'pickup-grenade-nw', taken: false },
    ]);
    expect(mgMesh.visible).toBe(true);
  });
});

// The real-model swap-in (R18's never-block, placeholder-on-failure
// contract). Mocks GLTFLoader the same way test/render/models.test.js does,
// since these loads flow through that exact loadPropModel/loadGltf seam --
// this suite is only asserting what pickupMeshes.js itself does with the
// result, not re-testing the loader.
describe('createPickupMeshes real model swap-in', () => {
  afterEach(() => {
    vi.doUnmock('three/addons/loaders/GLTFLoader.js');
    vi.resetModules();
  });

  function fakeModelScene(tag) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.userData.tag = tag; // distinguishes "this is the loaded model" from the placeholder box, which carries no such tag
    return mesh;
  }

  // Flushes every pending microtask (the loadGltf -> loadPropModel ->
  // swap-in .then() chain) regardless of how many hops it takes, by
  // yielding to a macrotask -- microtasks always drain before the next one
  // runs.
  function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('swaps the placeholder box for the real, grounded model once each load resolves', async () => {
    vi.resetModules();
    const load = vi.fn((url, onLoad) => {
      onLoad({ scene: fakeModelScene(url.includes('grenade') ? 'grenade' : 'machinegun'), animations: [] });
    });
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: vi.fn().mockImplementation(() => ({ load })),
    }));

    const { createPickupMeshes: createPickupMeshesMocked } = await import('../../src/render/pickupMeshes.js');
    const scene = new THREE.Scene();
    createPickupMeshesMocked(scene, FAKE_PICKUPS);
    await flushMicrotasks();

    expect(scene.children).toHaveLength(FAKE_PICKUPS.length);
    const [mgMesh, grenadeMesh] = scene.children;
    expect(mgMesh.userData.tag).toBe('machinegun');
    expect(grenadeMesh.userData.tag).toBe('grenade');

    // Real-asset era: mesh.name convention preserved, castShadow preserved,
    // grounded at y = offset.y (not pickup.y=1's sim anchor, and not
    // PICKUP_Y_OFFSET's floating placeholder height).
    expect(mgMesh.name).toBe('pickup-machinegun');
    expect(mgMesh.castShadow).toBe(true);
    expect(mgMesh.position.y).toBeCloseTo(MACHINEGUN_PICKUP_MODEL.offset.y, 5);
    expect(mgMesh.position.x).toBeCloseTo(5 + MACHINEGUN_PICKUP_MODEL.offset.x, 5);
    expect(mgMesh.position.z).toBeCloseTo(5 + MACHINEGUN_PICKUP_MODEL.offset.z, 5);
    expect(mgMesh.scale.x).toBeCloseTo(MACHINEGUN_PICKUP_MODEL.scale, 5);
    // Rolled onto its side, not left standing in its held orientation.
    expect(mgMesh.rotation.z).toBeCloseTo(Math.PI / 2, 5);

    expect(grenadeMesh.name).toBe('pickup-grenade');
    expect(grenadeMesh.castShadow).toBe(true);
    expect(grenadeMesh.position.y).toBeCloseTo(GRENADE_MODEL.offset.y, 5);
    expect(grenadeMesh.position.x).toBeCloseTo(-32 + GRENADE_MODEL.offset.x, 5);
    expect(grenadeMesh.position.z).toBeCloseTo(32 + GRENADE_MODEL.offset.z, 5);
    expect(grenadeMesh.scale.x).toBeCloseTo(GRENADE_MODEL.scale, 5);
    expect(grenadeMesh.rotation.z).toBeCloseTo(0, 5);
  });

  it('carries the placeholder\'s current visibility over to the swapped-in model', async () => {
    vi.resetModules();
    const load = vi.fn((url, onLoad) => {
      onLoad({ scene: fakeModelScene('any'), animations: [] });
    });
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: vi.fn().mockImplementation(() => ({ load })),
    }));

    const { createPickupMeshes: createPickupMeshesMocked } = await import('../../src/render/pickupMeshes.js');
    const scene = new THREE.Scene();
    const pickupMeshes = createPickupMeshesMocked(scene, FAKE_PICKUPS);

    // Taken (and thus hidden) while the model is still loading -- the swap
    // must not silently reveal it again.
    pickupMeshes.update([{ id: 'pickup-grenade-nw', taken: true }]);
    await flushMicrotasks();

    const grenadeMesh = scene.children.find((child) => child.name === 'pickup-grenade');
    expect(grenadeMesh.visible).toBe(false);

    // update() still finds it by id after the swap -- the persistent-mesh
    // contract (KTD7) holds across the placeholder-to-model transition too.
    pickupMeshes.update([{ id: 'pickup-grenade-nw', taken: false }]);
    expect(grenadeMesh.visible).toBe(true);
  });

  it('disposes the placeholder box it swaps out', async () => {
    vi.resetModules();
    const load = vi.fn((url, onLoad) => {
      onLoad({ scene: fakeModelScene('any'), animations: [] });
    });
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: vi.fn().mockImplementation(() => ({ load })),
    }));

    const { createPickupMeshes: createPickupMeshesMocked } = await import('../../src/render/pickupMeshes.js');
    const scene = new THREE.Scene();
    createPickupMeshesMocked(scene, [FAKE_PICKUPS[1]]);
    const [placeholder] = scene.children;
    const geometryDispose = vi.spyOn(placeholder.geometry, 'dispose');
    const materialDispose = vi.spyOn(placeholder.material, 'dispose');

    await flushMicrotasks();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(scene.children).not.toContain(placeholder);
  });

  it('leaves the placeholder box in place if the model load fails (R18)', async () => {
    vi.resetModules();
    const load = vi.fn((url, onLoad, onProgress, onLoadError) => {
      onLoadError(new Error('network blip'));
    });
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: vi.fn().mockImplementation(() => ({ load })),
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { createPickupMeshes: createPickupMeshesMocked } = await import('../../src/render/pickupMeshes.js');
    const scene = new THREE.Scene();
    createPickupMeshesMocked(scene, FAKE_PICKUPS);
    const placeholders = [...scene.children];
    await flushMicrotasks();

    expect(scene.children).toEqual(placeholders);
    expect(scene.children).toHaveLength(FAKE_PICKUPS.length);
    for (const mesh of scene.children) expect(mesh.geometry.type).toBe('BoxGeometry');
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
