import * as THREE from 'three';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '../sim/movement.js';

// Placeholder capsule matching the sim's character capsule dimensions.
// Reads CAPSULE_RADIUS/CAPSULE_HALF_HEIGHT directly rather than duplicating
// them as literals, so the two can't silently drift the way they once did
// (the physics capsule widened but this geometry stayed at its old radius).
// This is also the permanent bot visual on a failed GLTF load (R9's error
// path), not just a brief flicker before the real model swaps in -- origin
// is the mesh's geometric center, matching the Rapier rigid body's
// translation convention.
export function createCharacterMesh({ color = 0xcc4444 } = {}) {
  const geometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 4, 8);
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

// THREE cameras look down their local -Z axis by default, but every other
// convention in this codebase (movement.js's forward vector, weapon.js's
// hitscan direction, bot mesh rotation) treats +Z as "front" for a given
// yaw -- so camera.rotation.y = simYaw alone faces the camera in the exact
// opposite world direction from where the weapon actually fires (a bug
// that shipped once: every shot fired 180 degrees from what was on
// screen). Composing the correction here (rather than leaving a bare
// inline +Math.PI in the render loop) keeps it from being "simplified
// away" as apparently-redundant by a later reader who doesn't know why
// it's there, and makes it independently testable against weapon.js's
// hitscan formula.
export function computeCameraYaw(simYaw) {
  return simYaw + Math.PI;
}
