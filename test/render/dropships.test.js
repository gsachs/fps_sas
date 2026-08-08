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

  // The victory flight: the landing the whole match was fought to allow. The
  // same drone doing the opposite of its usual job, which is the point.
  describe('victory flight', () => {
    const CENTRE = { x: -1, z: 3.5 };

    it('sends nothing until the match is actually won', () => {
      const scene = new THREE.Scene();
      const fleet = createDropshipFleet(scene);

      for (let i = 0; i < 300; i += 1) fleet.update(1 / 60);

      expect(drones(scene)).toHaveLength(0);
    });

    it('launches the first craft immediately, then keeps them coming', () => {
      const scene = new THREE.Scene();
      const fleet = createDropshipFleet(scene);

      fleet.beginVictoryFlight(CENTRE);
      fleet.update(1 / 60);
      expect(drones(scene)).toHaveLength(1);

      for (let i = 0; i < 600; i += 1) fleet.update(1 / 60);
      expect(fleet.count()).toBeGreaterThan(1);
    });

    it('brings them in from outside the site and settles them over it', () => {
      const scene = new THREE.Scene();
      const fleet = createDropshipFleet(scene);
      fleet.beginVictoryFlight(CENTRE);
      fleet.update(1 / 60);
      const [craft] = drones(scene);
      const distanceOut = Math.hypot(craft.position.x - CENTRE.x, craft.position.z - CENTRE.z);
      const startHeight = craft.position.y;

      for (let i = 0; i < 700; i += 1) fleet.update(1 / 60);

      // Inbound and descending: closer than it started, and lower.
      expect(Math.hypot(craft.position.x - CENTRE.x, craft.position.z - CENTRE.z)).toBeLessThan(
        distanceOut / 2
      );
      expect(craft.position.y).toBeLessThan(startHeight);
    });

    it('holds station once arrived, rather than expiring like a departing drop', () => {
      const scene = new THREE.Scene();
      const fleet = createDropshipFleet(scene);
      fleet.beginVictoryFlight(CENTRE);
      fleet.update(1 / 60);
      const [craft] = drones(scene);

      // Thirty seconds -- many times the lifetime a departing drop is retired
      // at, and long after the whole flight has arrived.
      for (let i = 0; i < 1800; i += 1) fleet.update(1 / 60);

      expect(scene.children).toContain(craft);
    });

    it('is a finite flight: it stops sending once the landing is in', () => {
      const scene = new THREE.Scene();
      const fleet = createDropshipFleet(scene);
      fleet.beginVictoryFlight(CENTRE);

      // Thirty seconds is well past the last craft's launch slot, so the
      // flight is complete by here.
      for (let i = 0; i < 1800; i += 1) fleet.update(1 / 60);
      const wholeFlight = fleet.count();
      for (let i = 0; i < 6000; i += 1) fleet.update(1 / 60);

      // Unbounded sending would eventually evict arrived craft to stay under
      // the active cap, and an arriving craft holds station rather than
      // fading, so that eviction would pop it off the sky in plain view.
      expect(fleet.count()).toBe(wholeFlight);
      expect(fleet.count()).toBeLessThanOrEqual(8);
    });

    it('stops on a match reset, so the next match does not open under the last one\'s landing', () => {
      const scene = new THREE.Scene();
      const fleet = createDropshipFleet(scene);
      fleet.beginVictoryFlight(CENTRE);
      for (let i = 0; i < 300; i += 1) fleet.update(1 / 60);

      fleet.resetAll();
      for (let i = 0; i < 300; i += 1) fleet.update(1 / 60);

      expect(drones(scene)).toHaveLength(0);
    });
  });
});
