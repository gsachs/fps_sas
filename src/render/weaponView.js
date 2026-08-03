import * as THREE from 'three';

// Placeholder first-person weapon: a low-poly box parented to the camera
// (so it always renders at a fixed screen position), with a brief recoil
// kick and muzzle flash on fire. Swapped for a real weapon model in U9.
const RECOIL_KICK = 0.06;
const RECOIL_RECOVERY_RATE = 10; // higher = snaps back faster
const MUZZLE_FLASH_SECONDS = 0.05;

export function createWeaponView(camera) {
  const group = new THREE.Group();
  group.position.set(0.28, -0.22, -0.5);
  camera.add(group);

  const gunMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b })
  );
  group.add(gunMesh);

  const muzzleLight = new THREE.PointLight(0xffcc66, 0, 3);
  muzzleLight.position.set(0, 0, -0.2);
  group.add(muzzleLight);

  let recoilOffset = 0;
  let muzzleFlashRemaining = 0;

  function fire() {
    recoilOffset = RECOIL_KICK;
    muzzleFlashRemaining = MUZZLE_FLASH_SECONDS;
  }

  function update(deltaSeconds) {
    recoilOffset *= Math.exp(-RECOIL_RECOVERY_RATE * deltaSeconds);
    if (recoilOffset < 0.001) recoilOffset = 0;
    gunMesh.position.z = recoilOffset;

    if (muzzleFlashRemaining > 0) {
      muzzleFlashRemaining -= deltaSeconds;
      muzzleLight.intensity = muzzleFlashRemaining > 0 ? 4 : 0;
    }
  }

  return { fire, update };
}
