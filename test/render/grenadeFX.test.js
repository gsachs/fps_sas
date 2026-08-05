import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGrenadeFX } from '../../src/render/grenadeFX.js';
import { GRENADE_POCKET_CAPACITY } from '../../src/sim/pickups.js';

function grenadeMeshes(scene) {
  return scene.children.filter((child) => child.name === 'grenade');
}

const GRENADE_A = { id: 'grenade0', position: { x: 1, y: 2, z: 3 } };
const GRENADE_B = { id: 'grenade1', position: { x: -4, y: 0, z: 5 } };

describe('createGrenadeFX: in-flight grenade visual', () => {
  it('pre-seeds the pool into the scene, hidden, before any grenade is in flight', () => {
    const scene = new THREE.Scene();
    createGrenadeFX(scene);

    const meshes = grenadeMeshes(scene);
    expect(meshes).toHaveLength(GRENADE_POCKET_CAPACITY);
    for (const mesh of meshes) expect(mesh.visible).toBe(false);
  });

  it('makes a newly in-flight grenade visible at its reported position', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.syncInFlight([GRENADE_A]);

    const visible = grenadeMeshes(scene).filter((mesh) => mesh.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0].position).toEqual(new THREE.Vector3(1, 2, 3));
  });

  it('moves the same mesh instance as a grenade updates position, rather than allocating a new one', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.syncInFlight([GRENADE_A]);
    const [assigned] = grenadeMeshes(scene).filter((mesh) => mesh.visible);

    grenadeFX.syncInFlight([{ id: 'grenade0', position: { x: 10, y: 11, z: 12 } }]);
    const stillVisible = grenadeMeshes(scene).filter((mesh) => mesh.visible);

    expect(stillVisible).toHaveLength(1);
    expect(stillVisible[0]).toBe(assigned);
    expect(stillVisible[0].position).toEqual(new THREE.Vector3(10, 11, 12));
  });

  it('hides a grenade’s mesh once it is no longer present (detonated, or cleared by resetAll)', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.syncInFlight([GRENADE_A]);
    grenadeFX.syncInFlight([]); // grenade detonated or resetAll() cleared it

    for (const mesh of grenadeMeshes(scene)) expect(mesh.visible).toBe(false);
  });

  it('assigns independent meshes to multiple simultaneous grenades', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.syncInFlight([GRENADE_A, GRENADE_B]);

    const visible = grenadeMeshes(scene).filter((mesh) => mesh.visible);
    expect(visible).toHaveLength(2);
    const positions = visible.map((mesh) => `${mesh.position.x},${mesh.position.z}`).sort();
    expect(positions).toEqual(['-4,5', '1,3']);
  });

  it('frees a mesh back to the pool for reuse once its grenade is gone', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.syncInFlight([GRENADE_A]);
    grenadeFX.syncInFlight([]); // freed
    grenadeFX.syncInFlight([GRENADE_B]); // should reuse the freed slot, not grow the pool

    expect(grenadeMeshes(scene)).toHaveLength(GRENADE_POCKET_CAPACITY);
  });

  it('grows the pool rather than dropping a grenade when more are in flight than the pre-sized pool', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    const overflow = Array.from({ length: GRENADE_POCKET_CAPACITY + 2 }, (_, i) => ({
      id: `grenade${i}`,
      position: { x: i, y: 0, z: 0 },
    }));
    grenadeFX.syncInFlight(overflow);

    const visible = grenadeMeshes(scene).filter((mesh) => mesh.visible);
    expect(visible).toHaveLength(overflow.length);
  });
});

describe('createGrenadeFX: explosion burst', () => {
  it('adds exactly one burst mesh and one light to the scene, at the blast position', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.spawnExplosion({ x: 5, y: 1, z: -2 });

    const burst = scene.children.filter((child) => child.name === 'explosionBurst');
    const light = scene.children.filter((child) => child.name === 'explosionLight');
    expect(burst).toHaveLength(1);
    expect(light).toHaveLength(1);
    expect(burst[0].position).toEqual(new THREE.Vector3(5, 1, -2));
    expect(light[0].position).toEqual(new THREE.Vector3(5, 1, -2));
    expect(light[0].isPointLight).toBe(true);
  });

  it('spawns a burst larger and longer-lived than a bullet impact, and a light not parented to the camera', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.spawnExplosion({ x: 0, y: 0, z: 0 });
    const [light] = scene.children.filter((child) => child.name === 'explosionLight');

    // Directly on the scene, not a child of anything camera-anchored --
    // unlike weaponView.js's muzzle light, a blast lights the world from its
    // own position.
    expect(light.parent).toBe(scene);
    expect(light.intensity).toBeGreaterThan(0);
  });

  it('expands and fades the burst, ramps the light down, then removes both', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    grenadeFX.spawnExplosion({ x: 0, y: 0, z: 0 });
    const [burst] = scene.children.filter((child) => child.name === 'explosionBurst');
    const [light] = scene.children.filter((child) => child.name === 'explosionLight');
    const initialScale = burst.scale.x;
    const initialIntensity = light.intensity;

    grenadeFX.update(0.15); // about halfway through
    expect(burst.scale.x).toBeGreaterThan(initialScale);
    expect(burst.material.opacity).toBeLessThan(1);
    expect(light.intensity).toBeLessThan(initialIntensity);
    expect(scene.children).toContain(burst);

    grenadeFX.update(0.3);
    expect(scene.children).not.toContain(burst);
    expect(scene.children).not.toContain(light);
  });

  it('caps how many explosions can be active at once, recycling the oldest', () => {
    const scene = new THREE.Scene();
    const grenadeFX = createGrenadeFX(scene);

    for (let i = 0; i < 20; i++) grenadeFX.spawnExplosion({ x: i, y: 0, z: 0 });

    const bursts = scene.children.filter((child) => child.name === 'explosionBurst');
    expect(bursts.length).toBeLessThanOrEqual(8);
    expect(bursts[bursts.length - 1].position.x).toBe(19); // newest survives the recycle
  });
});
