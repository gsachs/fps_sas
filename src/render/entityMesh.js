import * as THREE from 'three';

// Placeholder capsule matching the sim's character capsule dimensions
// (movement.js: half-height 0.5, radius 0.3 -> length 1.0). Swapped for real
// animated models in U9; origin is the mesh's geometric center, matching the
// Rapier rigid body's translation convention.
export function createCharacterMesh({ color = 0xcc4444 } = {}) {
  const geometry = new THREE.CapsuleGeometry(0.3, 1.0, 4, 8);
  const material = new THREE.MeshStandardMaterial({ color });
  return new THREE.Mesh(geometry, material);
}
