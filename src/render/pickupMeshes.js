// Visible pickup items (R5): one persistent mesh per layout.js PICKUPS
// descriptor, built once and added to the scene once. Visibility toggles on
// take/respawn -- the same persistent-mesh-plus-visibility-toggle idiom
// main.js already uses for bot meshes -- deliberately not effect-pooling
// (KTD7): a pickup mesh exists for the whole match, it just hides.
import * as THREE from 'three';
import { MACHINEGUN_WEAPON_ID } from '../sim/weapon.js';
import { loadPropModel, disposeObject3D } from './models.js';
import { GRENADE_MODEL, MACHINEGUN_PICKUP_MODEL } from './modelAssets.js';

const PICKUP_HALF_SIZE = 0.4;
// Lifts the box above the pickup's ground-level descriptor position so it
// reads as a floating collectible, not a box sunk into the floor. Only ever
// used for the instant placeholder below -- the real model that swaps in
// once loaded is grounded properly instead (see loadRealPickupModel).
const PICKUP_Y_OFFSET = 0.5;

// Basic, structurally-distinguishable-by-type placeholder colors -- shown
// instantly so a slow or failed model load (R18) never leaves a pickup
// invisible; the real model swaps this out once it arrives.
const PICKUP_COLOR_BY_TYPE = {
  [MACHINEGUN_WEAPON_ID]: 0xd55e00,
  grenade: 0x2f8f5a,
};
const DEFAULT_PICKUP_COLOR = 0xffffff;

// Which real-asset descriptor (modelAssets.js) replaces a given pickup
// type's placeholder box, once loaded.
const PICKUP_MODEL_BY_TYPE = {
  [MACHINEGUN_WEAPON_ID]: MACHINEGUN_PICKUP_MODEL,
  grenade: GRENADE_MODEL,
};

// This module starts its own asset loads (below) rather than taking a
// resolved URL in, because its call site (main.js) must not change shape to
// launch them -- unlike scene.js's loadSkyBackground, which does take a
// resolved URL since main.js already calls it after this kind of setup.
// Mirrors main.js's own `assetUrl` helper: BASE_URL-relative so a subpath
// deployment still resolves correctly.
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;

function createPlaceholderMesh(pickup) {
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
  return mesh;
}

// Swaps `pickup`'s placeholder box for its real model once it arrives,
// through the same non-blocking, placeholder-on-failure shape as main.js's
// own bot-model and weapon-model async swap-in blocks (R18: a stalled or
// failed load leaves the box in place and the game stays playable). Grounds
// the model using its own measured bounding-box bottom, not `pickup.y`
// (src/sim/pickups.js's collection-detection anchor, untouched here) --
// same cosmetic-only correction computeBotMeshY already applies for bots.
function loadRealPickupModel(scene, meshById, pickup, model) {
  loadPropModel(assetUrl(model.path), {
    onError: (error) => console.warn(`Failed to load ${pickup.type} pickup model:`, error),
  }).then((result) => {
    if (!result.loaded) return;
    const { scene: modelScene } = result;
    const rotation = model.rotation ?? { x: 0, y: 0, z: 0 };
    modelScene.name = `pickup-${pickup.type}`;
    modelScene.scale.setScalar(model.scale);
    modelScene.rotation.set(rotation.x, rotation.y, rotation.z);
    modelScene.position.set(pickup.x + model.offset.x, model.offset.y, pickup.z + model.offset.z);
    modelScene.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });

    const placeholder = meshById.get(pickup.id);
    modelScene.visible = placeholder.visible;
    scene.remove(placeholder);
    disposeObject3D(placeholder);
    meshById.set(pickup.id, modelScene);
    scene.add(modelScene);
  });
}

export function createPickupMeshes(scene, pickups) {
  const meshById = new Map();

  for (const pickup of pickups) {
    const mesh = createPlaceholderMesh(pickup);
    scene.add(mesh);
    meshById.set(pickup.id, mesh);

    const model = PICKUP_MODEL_BY_TYPE[pickup.type];
    if (model) loadRealPickupModel(scene, meshById, pickup, model);
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
