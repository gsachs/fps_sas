import * as THREE from 'three';

// Low-poly meshes matching the arena's Rapier colliders (ground, boundary
// walls, cover boxes); callers add the returned group to their scene.
//
// The geometry stays deliberately simple -- box silhouettes are not what
// makes an untextured arena read as unfinished. What sells it as a place is
// shadow, so every surface here participates in shadow casting or receiving,
// and the colours are unchanged from when they were placeholders (R16).
export function buildArenaMeshes(arena) {
  const group = new THREE.Group();
  group.name = 'arena';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(arena.groundHalfSize * 2, arena.groundHalfSize * 2),
    new THREE.MeshStandardMaterial({ color: 0x6b8f5a, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  // Receives only: a flat plane has nothing to cast onto anything else, and
  // including it as a caster only costs shadow-map resolution.
  ground.receiveShadow = true;
  group.add(ground);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xa89f8a, roughness: 0.9 });
  const half = arena.groundHalfSize;
  const wallDescs = [
    { x: 0, z: half, sx: half * 2, sz: 0.5 },
    { x: 0, z: -half, sx: half * 2, sz: 0.5 },
    { x: half, z: 0, sx: 0.5, sz: half * 2 },
    { x: -half, z: 0, sx: 0.5, sz: half * 2 },
  ];
  for (const wall of wallDescs) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(wall.sx, arena.wallHeight, wall.sz),
      wallMaterial
    );
    mesh.position.set(wall.x, arena.wallHeight / 2, wall.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.85 });
  for (const box of arena.coverBoxes) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(box.halfX * 2, box.halfY * 2, box.halfZ * 2),
      coverMaterial
    );
    mesh.position.set(box.x, box.halfY, box.z);
    mesh.name = 'cover';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
