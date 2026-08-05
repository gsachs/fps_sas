import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPickupMeshes } from '../../src/render/pickupMeshes.js';

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
