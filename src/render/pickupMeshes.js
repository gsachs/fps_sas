// Visible pickup items (R5): one persistent mesh per layout.js PICKUPS
// descriptor, built once and added to the scene once. Visibility toggles on
// take/respawn -- the same persistent-mesh-plus-visibility-toggle idiom
// main.js already uses for bot meshes -- deliberately not effect-pooling
// (KTD7): a pickup mesh exists for the whole match, it just hides.
import * as THREE from 'three';
import { MACHINEGUN_WEAPON_ID } from '../sim/weapon.js';

const PICKUP_HALF_SIZE = 0.4;
// Lifts the box above the pickup's ground-level descriptor position so it
// reads as a floating collectible, not a box sunk into the floor.
const PICKUP_Y_OFFSET = 0.5;

// Basic, structurally-distinguishable-by-type placeholder colors -- U5 owns
// real presentation for held weapons; floor pickups just need to read as two
// different things (R5).
const PICKUP_COLOR_BY_TYPE = {
  [MACHINEGUN_WEAPON_ID]: 0xd55e00,
  grenade: 0x2f8f5a,
};
const DEFAULT_PICKUP_COLOR = 0xffffff;

export function createPickupMeshes(scene, pickups) {
  const meshById = new Map();

  for (const pickup of pickups) {
    const geometry = new THREE.BoxGeometry(
      PICKUP_HALF_SIZE * 2,
      PICKUP_HALF_SIZE * 2,
      PICKUP_HALF_SIZE * 2
    );
    const material = new THREE.MeshStandardMaterial({
      color: PICKUP_COLOR_BY_TYPE[pickup.type] ?? DEFAULT_PICKUP_COLOR,
      roughness: 0.6,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `pickup-${pickup.type}`;
    mesh.position.set(pickup.x, (pickup.y ?? 0) + PICKUP_Y_OFFSET, pickup.z);
    mesh.castShadow = true;
    scene.add(mesh);
    meshById.set(pickup.id, mesh);
  }

  // Reads pickupSystem.getPickupStates()'s output each frame -- the
  // render layer's only source of truth for what's currently taken.
  function update(pickupStates) {
    for (const state of pickupStates) {
      const mesh = meshById.get(state.id);
      if (mesh) mesh.visible = !state.taken;
    }
  }

  return { update };
}
