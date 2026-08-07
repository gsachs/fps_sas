import * as THREE from 'three';
import { disposeObject3D } from './models.js';
import { DEFAULT_WEAPON_ID } from '../sim/weapon.js';

// First-person weapon: a model parented to the camera (so it always renders
// at a fixed screen position), with a recoil kick and muzzle flash on fire.
// setModel() swaps in a real weapon model, disposing what was there;
// recoil/flash keep working the same way since they animate the group's
// current visual child, whichever it is.
//
// Children are looked up by name rather than by index because setModel
// appends the replacement model to the end of the group -- so the order of
// children changes the moment a real weapon loads, and anything indexing
// positionally reads the wrong object.
const RECOIL_KICK = 0.14;
const RECOIL_PITCH = 0.18; // radians the muzzle climbs at full kick
const RECOIL_RECOVERY_RATE = 11; // higher = snaps back faster
const MUZZLE_FLASH_SECONDS = 0.07;
const MUZZLE_FLASH_INTENSITY = 9;
const MUZZLE_FLASH_RADIUS = 0.07;
// KTD4: the render layer the viewmodel lives on exclusively. It is drawn
// only through the weapon camera's own depth-cleared pass (postfx.js's
// addWeaponPass), never through the main world camera -- moving it off the
// default layer (0) is what excludes it from the main RenderPass, which is
// what stops world geometry (walls) from ever being able to occlude it.
export const WEAPON_LAYER = 1;
// KTD4 "tight-frustum weapon camera": the viewmodel only ever sits a few
// tenths of a unit in front of the camera (group.position.z is -0.5, and
// recoil/rest offsets keep every visual within roughly [-0.7, -0.1]) -- a
// near/far range this short keeps depth precision high in that narrow band
// and comfortably contains any placeholder or loaded weapon model, current
// or future.
const WEAPON_CAMERA_NEAR = 0.01;
const WEAPON_CAMERA_FAR = 2;
// The camera jolts by a fraction of the weapon's own kick. Deliberately
// small: this is cosmetic only and must never move the aim point, so the
// simulation's pitch (which is what hitscans are actually resolved against)
// is untouched and shots still land exactly where the crosshair was.
const CAMERA_KICK_RATIO = 0.55;

// R10: the viewmodel shows the held weapon. `weaponVisuals` maps a weapon id
// to its own { visual, restPositionZ, restRotationX } -- pre-seeded with a
// placeholder box (visually distinct from anything registered later so a
// swap stays legible), and `setModel` (the MG GLB load in main.js) replaces
// an entry's visual in place without disturbing others registered alongside
// it by a future weapon-archetypes pass (KTD2). Only the active entry's
// visual is ever a child of `group`; `setHeldWeapon` is what moves that
// membership.
// KTD4: every viewmodel mesh -- placeholder, a loaded model, and any nested
// child a GLTF brings with it -- must land on WEAPON_LAYER exclusively and
// cast/receive no shadows. Layers and shadow flags don't cascade from a
// parent to its children on their own, so this has to walk the whole
// subtree rather than set them once at the root; centralising it here
// means every seam that hands `group` a new visual (registerVisual, and so
// setModel too) gets the guarantee automatically instead of by convention.
function moveToWeaponLayer(object) {
  object.traverse((node) => {
    node.layers.set(WEAPON_LAYER);
    node.castShadow = false;
    node.receiveShadow = false;
  });
}

function createPlaceholderVisual(color, size) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.name = 'weaponVisual';
  return mesh;
}

export function createWeaponView(camera) {
  const group = new THREE.Group();
  group.position.set(0.28, -0.22, -0.5);
  camera.add(group);

  const weaponVisuals = new Map();

  // Registers (or replaces) `weaponId`'s visual and rest transform, without
  // touching group membership -- callers decide whether the entry is
  // currently active.
  function registerVisual(weaponId, newVisual, localTransform = {}) {
    newVisual.name = 'weaponVisual';
    moveToWeaponLayer(newVisual);
    if (localTransform.position) newVisual.position.copy(localTransform.position);
    if (localTransform.rotation) newVisual.rotation.copy(localTransform.rotation);
    if (localTransform.scale) newVisual.scale.copy(localTransform.scale);
    weaponVisuals.set(weaponId, {
      visual: newVisual,
      restPositionZ: localTransform.position?.z ?? 0,
      restRotationX: localTransform.rotation?.x ?? 0,
    });
  }

  registerVisual(DEFAULT_WEAPON_ID, createPlaceholderVisual(0x3f6f9f, { x: 0.09, y: 0.1, z: 0.55 }));

  let activeWeaponId = DEFAULT_WEAPON_ID;
  let visual = weaponVisuals.get(activeWeaponId).visual;
  group.add(visual);

  const muzzleLight = new THREE.PointLight(0xffcc66, 0, 3);
  muzzleLight.position.set(0, 0, -0.2);
  muzzleLight.name = 'muzzleLight';
  muzzleLight.castShadow = false;
  // KTD4: enabled on *both* layers, not moved like the meshes above -- the
  // weapon camera's pass (layer WEAPON_LAYER only) needs it to light the
  // gun itself during the flash, and the main camera's pass (layer 0, its
  // default) still needs it to light the world, or a shot fired next to a
  // wall would stop lighting that wall the moment the gun moved layers.
  muzzleLight.layers.enable(WEAPON_LAYER);
  group.add(muzzleLight);

  // The light alone only brightens nearby surfaces; at arena range there are
  // often none, so a shot could light nothing and read as no shot at all.
  // This is the flash itself -- unlit geometry, visible regardless of scene
  // lighting.
  const muzzleFlash = new THREE.Mesh(
    new THREE.IcosahedronGeometry(MUZZLE_FLASH_RADIUS, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, depthWrite: false })
  );
  muzzleFlash.position.set(0, 0, -0.26);
  muzzleFlash.name = 'muzzleFlash';
  muzzleFlash.visible = false;
  moveToWeaponLayer(muzzleFlash);
  group.add(muzzleFlash);

  // KTD4: a second camera, driven by the same transform as `camera` --
  // parenting it the same way `group` is parented above means its world
  // matrix tracks `camera`'s automatically every frame via the normal scene
  // graph update, including the camera-kick jolt (main.js mutates `camera`'s
  // own rotation before each render). It only ever sees WEAPON_LAYER, so
  // postfx.js's depth-cleared weapon pass draws the viewmodel and nothing
  // else -- not even a wall a few centimetres away -- which is what makes
  // clipping impossible regardless of how close the player stands to
  // geometry.
  const weaponCamera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, WEAPON_CAMERA_NEAR, WEAPON_CAMERA_FAR);
  weaponCamera.layers.set(WEAPON_LAYER);
  camera.add(weaponCamera);

  let recoilOffset = 0;
  let muzzleFlashRemaining = 0;

  function fire() {
    recoilOffset = RECOIL_KICK;
    muzzleFlashRemaining = MUZZLE_FLASH_SECONDS;
  }

  function update(deltaSeconds) {
    // Checked here rather than wired into main.js's resize handler -- fov
    // never changes at runtime today and aspect only changes on window
    // resize, but this way the weapon camera can't drift out of sync with
    // the main camera no matter what changes it or when. Guarded so the
    // (otherwise per-frame) projection-matrix rebuild only actually runs on
    // the rare frame where one of them changed.
    if (camera.fov !== weaponCamera.fov || camera.aspect !== weaponCamera.aspect) {
      weaponCamera.fov = camera.fov;
      weaponCamera.aspect = camera.aspect;
      weaponCamera.updateProjectionMatrix();
    }

    // The active visual's own rest position (usually 0,0,0 for a
    // placeholder, but a loaded model may need a non-zero local offset --
    // e.g. to align its grip/muzzle with the group's origin). Recoil
    // animates *on top of* this rest position via position.z, never
    // overwrites it.
    const rest = weaponVisuals.get(activeWeaponId);
    recoilOffset *= Math.exp(-RECOIL_RECOVERY_RATE * deltaSeconds);
    if (recoilOffset < 0.001) recoilOffset = 0;
    visual.position.z = rest.restPositionZ + recoilOffset;
    // Kick the muzzle up in proportion to how far back the weapon has been
    // driven, so the gun pivots rather than sliding straight backward.
    visual.rotation.x = rest.restRotationX + (recoilOffset / RECOIL_KICK) * RECOIL_PITCH;

    if (muzzleFlashRemaining > 0) {
      muzzleFlashRemaining -= deltaSeconds;
      const alive = muzzleFlashRemaining > 0;
      muzzleLight.intensity = alive ? MUZZLE_FLASH_INTENSITY : 0;
      muzzleFlash.visible = alive;
      muzzleFlash.material.opacity = alive ? muzzleFlashRemaining / MUZZLE_FLASH_SECONDS : 0;
    }
  }

  // How far the camera should be pitched up this frame for the recoil jolt.
  // Read by the render loop *after* it applies the simulation's own pitch, so
  // it is layered on top of aim rather than folded into it.
  function getCameraKick() {
    return (recoilOffset / RECOIL_KICK) * CAMERA_KICK_RATIO * RECOIL_PITCH;
  }

  // Replaces `weaponId`'s visual (placeholder or a prior model) with
  // `model`, disposing the old one -- `weaponId` defaults to the default
  // weapon (main.js's MG GLB load, the only caller today). `localTransform`
  // lets the caller correct for a source model's own scale/orientation/
  // offset conventions. If `weaponId` is the currently active weapon the
  // change is visible immediately; otherwise it takes effect the next time
  // setHeldWeapon switches to it -- the seam a future weapon-archetypes
  // pass uses to register another model without changing this call's shape.
  function setModel(model, localTransform = {}, weaponId = DEFAULT_WEAPON_ID) {
    const previous = weaponVisuals.get(weaponId);
    const isActive = activeWeaponId === weaponId;
    if (isActive) group.remove(visual);
    if (previous) disposeObject3D(previous.visual);
    registerVisual(weaponId, model, localTransform);
    if (isActive) {
      visual = weaponVisuals.get(weaponId).visual;
      group.add(visual);
    }
  }

  // R10: shows whichever weapon is actually held -- swaps `group`'s one
  // active child to `weaponId`'s registered visual. A no-op (as cheap as a
  // Map lookup) when `weaponId` is already active, so main.js can call this
  // unconditionally every frame; an unregistered id is left showing
  // whatever is already active rather than going blank.
  function setHeldWeapon(weaponId) {
    if (weaponId === activeWeaponId) return;
    const next = weaponVisuals.get(weaponId);
    if (!next) return;
    group.remove(visual);
    visual = next.visual;
    group.add(visual);
    activeWeaponId = weaponId;
  }

  // weaponCamera is exposed here so main.js's own
  // `postfx.addWeaponPass(weaponView.weaponCamera)` can register the
  // depth-clear pass (KTD4) once both this view and the composer exist.
  return { fire, update, setModel, setHeldWeapon, getCameraKick, weaponCamera };
}
