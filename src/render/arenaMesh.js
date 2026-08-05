import * as THREE from 'three';

// Low-poly meshes matching the arena's Rapier colliders (ground, walls,
// landmark pillars); callers add the returned group to their scene. Walls
// and pillars are built straight off arena.walls/arena.pillars (KTD6) --
// one mesh per collider, so mesh count can never drift from collider count
// the way the old fixed-4-wall layout could.
//
// The geometry stays deliberately simple -- box silhouettes are not what
// makes an untextured arena read as unfinished. What sells it as a place is
// shadow, so every surface here participates in shadow casting or receiving,
// and the colours are unchanged from when they were placeholders (R16).
export function buildArenaMeshes(arena) {
  const group = new THREE.Group();
  group.name = 'arena';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(arena.floorHalfSize * 2, arena.floorHalfSize * 2),
    new THREE.MeshStandardMaterial({ color: 0x6b8f5a, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  // Receives only: a flat plane has nothing to cast onto anything else, and
  // including it as a caster only costs shadow-map resolution.
  ground.receiveShadow = true;
  group.add(ground);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xa89f8a, roughness: 0.9 });
  for (const wall of arena.walls) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(wall.halfX * 2, wall.halfY * 2, wall.halfZ * 2),
      wallMaterial
    );
    mesh.position.set(wall.x, wall.halfY, wall.z);
    mesh.name = 'wall';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.85 });
  for (const pillar of arena.pillars) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(pillar.halfX * 2, pillar.halfY * 2, pillar.halfZ * 2),
      pillarMaterial
    );
    mesh.position.set(pillar.x, pillar.halfY, pillar.z);
    mesh.name = 'pillar';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
