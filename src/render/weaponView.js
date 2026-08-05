import * as THREE from 'three';
import { disposeObject3D } from './models.js';

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
// The camera jolts by a fraction of the weapon's own kick. Deliberately
// small: this is cosmetic only and must never move the aim point, so the
// simulation's pitch (which is what hitscans are actually resolved against)
// is untouched and shots still land exactly where the crosshair was.
const CAMERA_KICK_RATIO = 0.55;

// R10: the viewmodel shows the held weapon. `weaponVisuals` maps a weapon id
// to its own { visual, restPositionZ, restRotationX } -- pre-seeded with a
// placeholder box per weapon (visually distinct so a swap is legible even
// before any real model loads), and `setModel` (existing pistol GLB load) or
// U5's eventual MG-model load replace one entry's visual in place without
// disturbing the others. Only the active entry's visual is ever a child of
// `group`; `setHeldWeapon` is what moves that membership.
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
    if (localTransform.position) newVisual.position.copy(localTransform.position);
    if (localTransform.rotation) newVisual.rotation.copy(localTransform.rotation);
    if (localTransform.scale) newVisual.scale.copy(localTransform.scale);
    weaponVisuals.set(weaponId, {
      visual: newVisual,
      restPositionZ: localTransform.position?.z ?? 0,
      restRotationX: localTransform.rotation?.x ?? 0,
    });
  }

  registerVisual('pistol', createPlaceholderVisual(0x2b2b2b, { x: 0.08, y: 0.08, z: 0.35 }));
  // Deliberately different size/color from the pistol placeholder (not just
  // a recolor of the same box) so the swap reads as a different weapon at a
  // glance even before U5's real MG model lands through setModel's same seam.
  registerVisual('machinegun', createPlaceholderVisual(0x3f6f9f, { x: 0.09, y: 0.1, z: 0.55 }));

  let activeWeaponId = 'pistol';
  let visual = weaponVisuals.get(activeWeaponId).visual;
  group.add(visual);

  const muzzleLight = new THREE.PointLight(0xffcc66, 0, 3);
  muzzleLight.position.set(0, 0, -0.2);
  muzzleLight.name = 'muzzleLight';
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
  group.add(muzzleFlash);

  let recoilOffset = 0;
  let muzzleFlashRemaining = 0;

  function fire() {
    recoilOffset = RECOIL_KICK;
    muzzleFlashRemaining = MUZZLE_FLASH_SECONDS;
  }

  function update(deltaSeconds) {
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
  // `model`, disposing the old one -- `weaponId` defaults to 'pistol', the
  // only caller today (the pistol GLB load in main.js), so that existing
  // call site keeps compiling and behaving identically. `localTransform`
  // lets the caller correct for a source model's own scale/orientation/
  // offset conventions. If `weaponId` is the currently active weapon the
  // change is visible immediately; otherwise it takes effect the next time
  // setHeldWeapon switches to it -- the seam U5 uses to register a real MG
  // model without changing this call's shape.
  function setModel(model, localTransform = {}, weaponId = 'pistol') {
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

  return { fire, update, setModel, setHeldWeapon, getCameraKick };
}
