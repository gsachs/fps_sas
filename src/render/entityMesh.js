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

// Some GLTF rigs are authored facing -Z at rest instead of matching the
// sim's yaw=0-faces-+Z convention; yawOffset corrects for that. Composing it
// here (rather than baking it into the loaded model's own rotation once)
// keeps it from being silently dropped by a later per-frame rotation.y
// assignment -- the exact bug this replaced.
export function computeBotMeshYaw(entityYaw, yawOffset = 0) {
  return entityYaw + yawOffset;
}

// GLTF character rigs are typically authored with a feet-based origin (feet
// at local y=0), but the Rapier capsule's translation -- entity.position --
// is its *center*. Placing a rig's origin directly at entity.position (as
// the placeholder capsule correctly does, since CapsuleGeometry is centered
// on its own origin) makes the model float roughly half its height above
// where the actual collider sits, so a shot aimed at the visible character
// can sail clean over the real hitbox. modelYOffset corrects for that, and
// composing it here (rather than baking a one-time position at load time)
// keeps it from being silently dropped the same way the yaw offset was.
export function computeBotMeshY(entityY, modelYOffset = 0) {
  return entityY + modelYOffset;
}
