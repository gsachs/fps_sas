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

export function createWeaponView(camera) {
  const group = new THREE.Group();
  group.position.set(0.28, -0.22, -0.5);
  camera.add(group);

  let visual = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b })
  );
  visual.name = 'weaponVisual';
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
  // The visual's own rest position (usually 0,0,0 for the placeholder, but
  // a loaded model may need a non-zero local offset -- e.g. to align its
  // grip/muzzle with the group's origin). Recoil animates *on top of* this
  // rest position via position.z, never overwrites it.
  let restPositionZ = 0;
  let restRotationX = 0;

  function fire() {
    recoilOffset = RECOIL_KICK;
    muzzleFlashRemaining = MUZZLE_FLASH_SECONDS;
  }

  function update(deltaSeconds) {
    recoilOffset *= Math.exp(-RECOIL_RECOVERY_RATE * deltaSeconds);
    if (recoilOffset < 0.001) recoilOffset = 0;
    visual.position.z = restPositionZ + recoilOffset;
    // Kick the muzzle up in proportion to how far back the weapon has been
    // driven, so the gun pivots rather than sliding straight backward.
    visual.rotation.x = restRotationX + (recoilOffset / RECOIL_KICK) * RECOIL_PITCH;

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

  // Replaces the current visual (placeholder or a prior model) with
  // `model`, disposing the old one. `localTransform` lets the caller
  // correct for a source model's own scale/orientation/offset conventions.
  function setModel(model, localTransform = {}) {
    group.remove(visual);
    disposeObject3D(visual);
    visual = model;
    visual.name = 'weaponVisual';
    restPositionZ = localTransform.position?.z ?? 0;
    restRotationX = localTransform.rotation?.x ?? 0;
    if (localTransform.position) visual.position.copy(localTransform.position);
    if (localTransform.rotation) visual.rotation.copy(localTransform.rotation);
    if (localTransform.scale) visual.scale.copy(localTransform.scale);
    group.add(visual);
  }

  return { fire, update, setModel, getCameraKick };
}
