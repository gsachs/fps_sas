import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDropshipFleet } from '../../src/render/dropships.js';

const drones = (scene) => scene.children.filter((child) => child.name === 'dropship');
const arriving = (id, position) => ({ id, airdropping: true, position });
const landed = (id, position) => ({ id, airdropping: false, position });

describe('dropship fleet', () => {
  it('sends a drone for an entity that has just started arriving', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);

    fleet.syncArrivals([arriving('bot0', { x: 10, y: 15, z: -4 })]);

    expect(drones(scene)).toHaveLength(1);
    const [drone] = drones(scene);
    expect(drone.position.x).toBe(10);
    expect(drone.position.z).toBe(-4);
    // Above the release point: the bot hangs underneath it.
    expect(drone.position.y).toBeGreaterThan(15);
  });

  it('sends one drone per arrival, not one per frame of the fall', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);
    const falling = arriving('bot0', { x: 0, y: 15, z: 0 });

    // The flag stays true for the whole ~0.8s descent; without transition
    // tracking this would stack a drone every frame of it.
    for (let i = 0; i < 50; i += 1) fleet.syncArrivals([falling]);

    expect(drones(scene)).toHaveLength(1);
  });

  it('sends nothing for an entity that is not arriving', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);

    fleet.syncArrivals([landed('bot0', { x: 0, y: 1, z: 0 })]);

    expect(drones(scene)).toHaveLength(0);
  });

  it('sends a fresh drone when the same bot arrives again later', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);
    const at = (y) => ({ x: 0, y, z: 0 });

    fleet.syncArrivals([arriving('bot0', at(15))]);
    fleet.syncArrivals([landed('bot0', at(1))]); // landed, and later killed
    fleet.syncArrivals([arriving('bot0', at(15))]); // dropped in again

    expect(drones(scene)).toHaveLength(2);
  });

  it('holds station, then flies away and climbs', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);
    fleet.syncArrivals([arriving('bot0', { x: 30, y: 15, z: 0 })]);
    const [drone] = drones(scene);
    const release = drone.position.clone();

    fleet.update(0.2); // still inside the hover window
    expect(drone.position.x).toBeCloseTo(release.x, 6);

    for (let i = 0; i < 60; i += 1) fleet.update(1 / 60);

    // Away from the arena's middle, so it leaves over the nearest wall
    // rather than flying back across the map.
    expect(drone.position.x).toBeGreaterThan(release.x);
    expect(drone.position.y).toBeGreaterThan(release.y);
  });

  it('leaves the scene once it is gone, rather than accumulating', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);
    fleet.syncArrivals([arriving('bot0', { x: 30, y: 15, z: 0 })]);

    for (let i = 0; i < 400; i += 1) fleet.update(1 / 60);

    expect(drones(scene)).toHaveLength(0);
    expect(fleet.count()).toBe(0);
  });

  it('caps concurrent drones on a busy ramp', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);

    for (let i = 0; i < 30; i += 1) {
      fleet.syncArrivals([arriving(`bot${i}`, { x: i, y: 15, z: 0 })]);
    }

    expect(fleet.count()).toBeLessThan(30);
    expect(drones(scene)).toHaveLength(fleet.count());
  });

  it('clears everything on a match reset', () => {
    const scene = new THREE.Scene();
    const fleet = createDropshipFleet(scene);
    fleet.syncArrivals([arriving('bot0', { x: 0, y: 15, z: 0 })]);

    fleet.resetAll();

    expect(drones(scene)).toHaveLength(0);
    // The transition memory resets too, or a bot still mid-fall across the
    // reset would never get a drone for its next arrival.
    fleet.syncArrivals([arriving('bot0', { x: 0, y: 15, z: 0 })]);
    expect(drones(scene)).toHaveLength(1);
  });
});
