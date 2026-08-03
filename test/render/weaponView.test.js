import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWeaponView } from '../../src/render/weaponView.js';

describe('createWeaponView', () => {
  it('parents the weapon group to the given camera', () => {
    const camera = new THREE.PerspectiveCamera();
    createWeaponView(camera);
    expect(camera.children.length).toBeGreaterThan(0);
  });

  it('kicks recoil and lights the muzzle flash on fire, then decays both over time', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const [group] = camera.children;
    const [gunMesh, muzzleLight] = group.children;

    weaponView.fire();
    weaponView.update(0); // apply the kick before any decay

    expect(gunMesh.position.z).toBeGreaterThan(0);
    expect(muzzleLight.intensity).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) weaponView.update(1 / 60); // ~1s of decay

    expect(gunMesh.position.z).toBe(0);
    expect(muzzleLight.intensity).toBe(0);
  });

  it('turns off the muzzle flash faster than the recoil settles', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const [group] = camera.children;
    const [, muzzleLight] = group.children;

    weaponView.fire();
    weaponView.update(0.06); // past the ~0.05s muzzle-flash duration

    expect(muzzleLight.intensity).toBe(0);
  });

  it('setModel swaps the placeholder for a real model and keeps recoil/flash working', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const [group] = camera.children;
    const [placeholder, muzzleLight] = group.children;

    const realModel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    weaponView.setModel(realModel, { position: new THREE.Vector3(1, 2, 3) });

    expect(group.children).toContain(realModel);
    expect(group.children).not.toContain(placeholder);
    expect(realModel.position).toEqual(new THREE.Vector3(1, 2, 3));

    weaponView.fire();
    weaponView.update(0);
    // Recoil animates on top of the model's own rest position (z=3), never
    // overwrites it -- this is the bug this test caught during authoring.
    expect(realModel.position.z).toBeCloseTo(3.06, 5);
    expect(muzzleLight.intensity).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) weaponView.update(1 / 60);
    expect(realModel.position.z).toBeCloseTo(3, 5); // settles back to rest, not to 0
  });
});
