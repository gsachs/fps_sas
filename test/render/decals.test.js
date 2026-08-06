import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDecalSystem, computeDecalOrientation } from '../../src/render/decals.js';

function decalMeshes(scene) {
  return scene.children.filter((child) => child.name === 'decal');
}

// KTD7: a directional sign test, not a magnitude test -- computeDecalOrientation
// takes a plain {x,y,z} normal (the module-boundary rule) and must carry the
// quad's own resting +Z forward axis onto that normal, so a decal always
// faces out of the surface it marks rather than into it.
describe('computeDecalOrientation (KTD7)', () => {
  it('orients a decal to face along a +X outward normal', () => {
    const orientation = computeDecalOrientation({ x: 1, y: 0, z: 0 });
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    expect(forward.x).toBeGreaterThan(0);
  });

  it('orients a decal to face along a -Z outward normal', () => {
    const orientation = computeDecalOrientation({ x: 0, y: 0, z: -1 });
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    expect(forward.z).toBeLessThan(0);
  });

  it('orients a decal to face straight up, e.g. a floor hit', () => {
    const orientation = computeDecalOrientation({ x: 0, y: 1, z: 0 });
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    expect(forward.y).toBeGreaterThan(0);
  });

  it('handles a normal exactly opposite the quad resting forward (+Z -> -Z)', () => {
    // setFromUnitVectors' antiparallel branch -- the one case a naive
    // cross-product approach gets wrong (undefined rotation axis).
    const orientation = computeDecalOrientation({ x: 0, y: 0, z: -1 });
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    expect(forward.z).toBeCloseTo(-1, 5);
  });
});

describe('createDecalSystem: pool math', () => {
  it('spawns one decal per spaced hit', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    decals.spawn({ x: -3, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    decals.spawn({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    decals.spawn({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

    expect(decalMeshes(scene)).toHaveLength(3);
  });

  // AE1: "a held burst into one spot produces a few deduplicated decals, not
  // one per round" -- the MG fires 30 rounds/sec, so this is the realistic
  // shape of one sustained burst into the same spot.
  it('dedups a burst of hits landing on the exact same spot into a single decal', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    for (let i = 0; i < 30; i++) decals.spawn({ x: 5, y: 0, z: 5 }, { x: 0, y: 0, z: 1 });

    expect(decalMeshes(scene)).toHaveLength(1);
  });

  it('dedups hits within the ~0.15-unit cluster radius, not just exact duplicates', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    decals.spawn({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    decals.spawn({ x: 0.1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }); // within 0.15

    expect(decalMeshes(scene)).toHaveLength(1);
  });

  it('does not dedup hits farther apart than the cluster radius', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    decals.spawn({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    decals.spawn({ x: 0.2, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }); // outside 0.15

    expect(decalMeshes(scene)).toHaveLength(2);
  });

  // KTD3: cap ~200, oldest evicted first, newest always survives.
  it('caps the persistent pool under sustained fire, keeping the newest after fades flush', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    for (let i = 0; i < 300; i++) decals.spawn({ x: i, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    decals.update(1); // longer than the eviction fade -- flush every retiring decal

    const meshes = decalMeshes(scene);
    expect(meshes.length).toBeLessThanOrEqual(200);
    expect(meshes.some((mesh) => mesh.position.x === 299)).toBe(true);
    expect(meshes.some((mesh) => mesh.position.x === 0)).toBe(false); // oldest is gone
  });

  // KTD3: "fade only under cap pressure" -- eviction is a ramp, not an
  // instant pop, so the outgoing mark is still visible (fading) for a beat.
  it('fades an evicted decal out under cap pressure rather than removing it instantly', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    for (let i = 0; i < 201; i++) decals.spawn({ x: i, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    // Right after the 201st spawn evicts the oldest (x=0), it should still
    // be present in the scene, mid-fade.
    const evicted = decalMeshes(scene).find((mesh) => mesh.position.x === 0);
    expect(evicted).toBeDefined();

    decals.update(0.05); // a small step into the fade ramp
    expect(evicted.material.opacity).toBeLessThan(1);
    expect(evicted.material.opacity).toBeGreaterThan(0);

    decals.update(1); // flush the rest of the ramp
    expect(decalMeshes(scene)).not.toContain(evicted);
  });

  it('does not touch the pool below cap -- no eviction, no fading', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    decals.spawn({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    decals.update(1);

    expect(decalMeshes(scene)).toHaveLength(1);
  });

  it('resetAll clears every decal, active and fading alike', () => {
    const scene = new THREE.Scene();
    const decals = createDecalSystem(scene, new THREE.Group());

    for (let i = 0; i < 201; i++) decals.spawn({ x: i, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }); // one active, one fading

    decals.resetAll();

    expect(decalMeshes(scene)).toHaveLength(0);
  });
});

// KTD2: the raycast-against-real-meshes integration -- a plane standing in
// for a wall, rotated to face -Z (into the "room" a shooter at negative z
// stands in), the same way a real arena wall faces the space it bounds.
function buildWallGroup() {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial());
  wall.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(wall);
  group.updateMatrixWorld(true);
  return group;
}

describe('createDecalSystem: spawnFromFireEvent (KTD2)', () => {
  it('raycasts the fire segment against the arena meshes and places a decal at the visible hit point', () => {
    const scene = new THREE.Scene();
    const arenaMeshes = buildWallGroup();
    const decals = createDecalSystem(scene, arenaMeshes);

    decals.spawnFromFireEvent({ x: 2, y: 0, z: -5 }, { x: 2, y: 0, z: 5 });

    const [decal] = decalMeshes(scene);
    expect(decal).toBeDefined();
    expect(decal.position.x).toBeCloseTo(2, 5);
    expect(decal.position.z).toBeCloseTo(0, 1); // at the plane, plus a tiny surface offset
  });

  it('orients the placed decal to face back out toward the shooter', () => {
    const scene = new THREE.Scene();
    const arenaMeshes = buildWallGroup();
    const decals = createDecalSystem(scene, arenaMeshes);

    decals.spawnFromFireEvent({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 5 });

    const [decal] = decalMeshes(scene);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(decal.quaternion);
    expect(forward.z).toBeLessThan(0); // faces back toward -Z, where the shot came from
  });

  it('spawns nothing when the fire segment hits nothing (a total miss)', () => {
    const scene = new THREE.Scene();
    const arenaMeshes = buildWallGroup(); // a 10x10 plane centered at the origin
    const decals = createDecalSystem(scene, arenaMeshes);

    decals.spawnFromFireEvent({ x: 100, y: 0, z: -5 }, { x: 100, y: 0, z: 5 }); // well off the plane

    expect(decalMeshes(scene)).toHaveLength(0);
  });

  it('does not report a hit beyond the sim-resolved endpoint distance', () => {
    const scene = new THREE.Scene();
    const arenaMeshes = buildWallGroup();
    const decals = createDecalSystem(scene, arenaMeshes);

    // The wall sits at z=0; this segment stops well short of it at z=-4, so
    // an unbounded raycast would wrongly find the wall past the resolved end.
    decals.spawnFromFireEvent({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: -4 });

    expect(decalMeshes(scene)).toHaveLength(0);
  });

  it('is a no-op on a zero-length segment (origin === endPoint)', () => {
    const scene = new THREE.Scene();
    const arenaMeshes = buildWallGroup();
    const decals = createDecalSystem(scene, arenaMeshes);

    expect(() => decals.spawnFromFireEvent({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: -5 })).not.toThrow();
    expect(decalMeshes(scene)).toHaveLength(0);
  });
});
