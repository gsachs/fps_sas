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
});
