import * as THREE from 'three';
import { disposeObject3D } from './models.js';

// First-person weapon: a placeholder box parented to the camera (so it
// always renders at a fixed screen position), with a brief recoil kick and
// muzzle flash on fire. setModel() swaps in a real weapon model (U9),
// disposing the placeholder; recoil/flash keep working the same way since
// they animate the group's current visual child, whichever it is.
const RECOIL_KICK = 0.06;
const RECOIL_RECOVERY_RATE = 10; // higher = snaps back faster
const MUZZLE_FLASH_SECONDS = 0.05;

export function createWeaponView(camera) {
  const group = new THREE.Group();
  group.position.set(0.28, -0.22, -0.5);
  camera.add(group);

  let visual = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b })
  );
  group.add(visual);

  const muzzleLight = new THREE.PointLight(0xffcc66, 0, 3);
  muzzleLight.position.set(0, 0, -0.2);
  group.add(muzzleLight);

  let recoilOffset = 0;
  let muzzleFlashRemaining = 0;
  // The visual's own rest position (usually 0,0,0 for the placeholder, but
  // a loaded model may need a non-zero local offset -- e.g. to align its
  // grip/muzzle with the group's origin). Recoil animates *on top of* this
  // rest position via position.z, never overwrites it.
  let restPositionZ = 0;

  function fire() {
    recoilOffset = RECOIL_KICK;
    muzzleFlashRemaining = MUZZLE_FLASH_SECONDS;
  }

  function update(deltaSeconds) {
    recoilOffset *= Math.exp(-RECOIL_RECOVERY_RATE * deltaSeconds);
    if (recoilOffset < 0.001) recoilOffset = 0;
    visual.position.z = restPositionZ + recoilOffset;

    if (muzzleFlashRemaining > 0) {
      muzzleFlashRemaining -= deltaSeconds;
      muzzleLight.intensity = muzzleFlashRemaining > 0 ? 4 : 0;
    }
  }

  // Replaces the current visual (placeholder or a prior model) with
  // `model`, disposing the old one. `localTransform` lets the caller
  // correct for a source model's own scale/orientation/offset conventions.
  function setModel(model, localTransform = {}) {
    group.remove(visual);
    disposeObject3D(visual);
    visual = model;
    restPositionZ = localTransform.position?.z ?? 0;
    if (localTransform.position) visual.position.copy(localTransform.position);
    if (localTransform.rotation) visual.rotation.copy(localTransform.rotation);
    if (localTransform.scale) visual.scale.copy(localTransform.scale);
    group.add(visual);
  }

  return { fire, update, setModel };
}
