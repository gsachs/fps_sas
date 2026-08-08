import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWeaponView, WEAPON_LAYER } from '../../src/render/weaponView.js';

// Children are found by name, never by index. setModel appends the
// replacement model to the end of the group, so positional destructuring
// reads a different object before and after a model loads -- and the muzzle
// flash added alongside the light shifted every index again. Naming makes
// these tests survive the next child that gets added.
function parts(camera) {
  const [group] = camera.children;
  return {
    group,
    gun: group.getObjectByName('weaponVisual'),
    light: group.getObjectByName('muzzleLight'),
    flash: group.getObjectByName('muzzleFlash'),
  };
}

describe('createWeaponView', () => {
  it('parents the weapon group to the given camera', () => {
    const camera = new THREE.PerspectiveCamera();
    createWeaponView(camera);
    expect(camera.children.length).toBeGreaterThan(0);
  });

  it('kicks recoil and lights the muzzle flash on fire, then decays both over time', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { gun, light } = parts(camera);

    weaponView.fire();
    weaponView.update(0); // apply the kick before any decay

    expect(gun.position.z).toBeGreaterThan(0);
    expect(light.intensity).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) weaponView.update(1 / 60); // ~1s of decay

    expect(gun.position.z).toBe(0);
    expect(light.intensity).toBe(0);
  });

  it('shows a visible muzzle flash, not just a light that needs a nearby surface', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { flash } = parts(camera);

    expect(flash.visible).toBe(false);

    weaponView.fire();
    weaponView.update(0);
    expect(flash.visible).toBe(true);
    expect(flash.material.opacity).toBeGreaterThan(0);

    weaponView.update(0.1); // past the flash duration
    expect(flash.visible).toBe(false);
  });

  it('turns off the muzzle flash faster than the recoil settles', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { light } = parts(camera);

    weaponView.fire();
    weaponView.update(0.08); // past the muzzle-flash duration

    expect(light.intensity).toBe(0);
  });

  it('pitches the muzzle up under recoil and returns it to rest', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { gun } = parts(camera);

    weaponView.fire();
    weaponView.update(0);
    expect(gun.rotation.x).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) weaponView.update(1 / 60);
    expect(gun.rotation.x).toBeCloseTo(0, 5);
  });

  it('reports a camera punch that peaks on fire and decays to nothing', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);

    expect(weaponView.getCameraPunch()).toBe(0);

    weaponView.fire();
    weaponView.update(0);
    expect(weaponView.getCameraPunch()).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) weaponView.update(1 / 60);
    expect(weaponView.getCameraPunch()).toBe(0);
  });

  // R5/R17: the jolt must never move the aim point. The crosshair is pinned
  // to the centre of the screen, so it points wherever the camera points --
  // which makes "does the jolt rotate the camera" the whole question. The
  // retired pitch-based kick held the camera ~5 degrees off the shot line
  // for as long as the trigger was down, putting rounds over the head of
  // anything past point-blank while the crosshair sat on it.
  it('punches the camera without turning it, so the crosshair keeps marking the shot', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    camera.updateMatrixWorld(true);
    const aimBefore = camera.getWorldDirection(new THREE.Vector3()).clone();

    weaponView.fire();
    weaponView.update(0);
    // Applied exactly as main.js's render loop applies it.
    camera.translateZ(weaponView.getCameraPunch());
    camera.updateMatrixWorld(true);

    const aimAfter = camera.getWorldDirection(new THREE.Vector3());
    expect(aimAfter.angleTo(aimBefore)).toBe(0);
    // ...and the punch is along that same unchanged axis, so the crosshair
    // ray stays collinear with the shot rather than merely parallel to it.
    expect(camera.position.clone().normalize().angleTo(aimBefore)).toBeCloseTo(Math.PI, 6);
  });

  it('setModel swaps the placeholder for a real model and keeps recoil/flash working', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { group, gun: placeholder, light } = parts(camera);

    const realModel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    weaponView.setModel(realModel, { position: new THREE.Vector3(1, 2, 3) });

    expect(group.children).toContain(realModel);
    expect(group.children).not.toContain(placeholder);
    expect(realModel.position).toEqual(new THREE.Vector3(1, 2, 3));

    weaponView.fire();
    weaponView.update(0);
    // Recoil animates on top of the model's own rest position (z=3), never
    // overwrites it -- this is the bug this test caught during authoring.
    expect(realModel.position.z).toBeCloseTo(3.14, 5);
    expect(light.intensity).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) weaponView.update(1 / 60);
    expect(realModel.position.z).toBeCloseTo(3, 5); // settles back to rest, not to 0
  });

  // Only the machine gun ships today, but registerVisual/setHeldWeapon stay
  // generic (KTD2's registry seam for the deferred weapon-archetypes pass)
  // -- these tests register a second, made-up weapon id purely to exercise
  // that seam, not because a second weapon exists yet.
  it('setHeldWeapon swaps to a visually distinct registered placeholder and back to the default', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { group, gun: defaultPlaceholder } = parts(camera);
    const otherModel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    weaponView.setModel(otherModel, {}, 'other-weapon');

    weaponView.setHeldWeapon('other-weapon');

    expect(group.getObjectByName('weaponVisual')).toBe(otherModel);
    expect(group.children).toContain(otherModel);
    expect(group.children).not.toContain(defaultPlaceholder);

    weaponView.setHeldWeapon('machinegun');
    expect(group.getObjectByName('weaponVisual')).toBe(defaultPlaceholder);
    expect(group.children).toContain(defaultPlaceholder);
    expect(group.children).not.toContain(otherModel);
  });

  it('setHeldWeapon is a no-op when the requested weapon is already active', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { group } = parts(camera);
    const childrenBefore = [...group.children];

    weaponView.setHeldWeapon('machinegun'); // already active by default

    expect(group.children).toEqual(childrenBefore);
  });

  it('switching back to the default weapon after setModel shows the loaded model, not the original placeholder', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const realModel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());

    weaponView.setModel(realModel, { position: new THREE.Vector3(0, 0, 0.1) });
    weaponView.setHeldWeapon('other-weapon'); // unregistered -- no-op, stays on the default
    weaponView.setHeldWeapon('machinegun');

    const { group } = parts(camera);
    expect(group.getObjectByName('weaponVisual')).toBe(realModel);
  });

  it('setModel on an inactive weapon id does not disturb the currently displayed visual', () => {
    const camera = new THREE.PerspectiveCamera();
    const weaponView = createWeaponView(camera);
    const { group, gun: defaultPlaceholder } = parts(camera);

    const otherModel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    weaponView.setModel(otherModel, {}, 'other-weapon'); // the default weapon is still active

    expect(group.getObjectByName('weaponVisual')).toBe(defaultPlaceholder);
    expect(group.children).not.toContain(otherModel);

    weaponView.setHeldWeapon('other-weapon');
    expect(group.getObjectByName('weaponVisual')).toBe(otherModel);
  });

  // KTD4/AE2: the viewmodel is only ever drawn through its own depth-cleared
  // pass (postfx.js's addWeaponPass), never through the main world camera --
  // that's what makes it impossible for world geometry to occlude it. Moving
  // it off layer 0 is what excludes it from the main RenderPass; landing it
  // on WEAPON_LAYER exclusively (not both) is what stops it from *also*
  // getting drawn -- and potentially depth-tested against a wall a few
  // centimetres away -- a second time in the main pass.
  describe('weapon render layer (KTD4)', () => {
    it('puts the weapon visual and muzzle flash on the weapon layer only, not the default layer', () => {
      const camera = new THREE.PerspectiveCamera();
      const weaponView = createWeaponView(camera);
      const { gun, flash } = parts(camera);

      expect(gun.layers.isEnabled(WEAPON_LAYER)).toBe(true);
      expect(gun.layers.isEnabled(0)).toBe(false);
      expect(flash.layers.isEnabled(WEAPON_LAYER)).toBe(true);
      expect(flash.layers.isEnabled(0)).toBe(false);
    });

    it('enables the muzzle light on both the default layer and the weapon layer, so it lights the world and the gun', () => {
      const camera = new THREE.PerspectiveCamera();
      const weaponView = createWeaponView(camera);
      const { light } = parts(camera);

      expect(light.layers.isEnabled(0)).toBe(true);
      expect(light.layers.isEnabled(WEAPON_LAYER)).toBe(true);
    });

    it('moves a model swapped in via setModel onto the weapon layer, including nested child meshes', () => {
      const camera = new THREE.PerspectiveCamera();
      const weaponView = createWeaponView(camera);

      const nestedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      const root = new THREE.Group();
      root.add(nestedMesh);

      weaponView.setModel(root);

      expect(root.layers.isEnabled(WEAPON_LAYER)).toBe(true);
      expect(root.layers.isEnabled(0)).toBe(false);
      expect(nestedMesh.layers.isEnabled(WEAPON_LAYER)).toBe(true);
      expect(nestedMesh.layers.isEnabled(0)).toBe(false);
    });
  });

  // KTD4: "the viewmodel casts and receives no shadows" -- asserted directly
  // rather than left as an accident of these meshes' defaults, so a future
  // model swap (U5's real MG model, which may default shadows on) can't
  // silently regress it.
  describe('viewmodel shadows off (KTD4)', () => {
    it('disables cast and receive shadow on the weapon visual and muzzle flash', () => {
      const camera = new THREE.PerspectiveCamera();
      const weaponView = createWeaponView(camera);
      const { gun, flash } = parts(camera);

      expect(gun.castShadow).toBe(false);
      expect(gun.receiveShadow).toBe(false);
      expect(flash.castShadow).toBe(false);
      expect(flash.receiveShadow).toBe(false);
    });

    it('forces shadows off on a model swapped in via setModel, even if the source model defaults them on', () => {
      const camera = new THREE.PerspectiveCamera();
      const weaponView = createWeaponView(camera);

      const nestedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      nestedMesh.castShadow = true;
      nestedMesh.receiveShadow = true;
      const root = new THREE.Group();
      root.castShadow = true;
      root.add(nestedMesh);

      weaponView.setModel(root);

      expect(root.castShadow).toBe(false);
      expect(nestedMesh.castShadow).toBe(false);
      expect(nestedMesh.receiveShadow).toBe(false);
    });
  });

  // KTD4: "its own tight-frustum camera ... driven by the same transform."
  // Parenting it to the main camera with an identity local transform is what
  // makes it track the main camera's world transform (position, rotation,
  // and the existing camera-kick jolt) for free every frame, the same way
  // the weapon group itself already does.
  describe('weapon camera (KTD4)', () => {
    it('exposes a weapon camera parented to the main camera at an identity local transform', () => {
      const camera = new THREE.PerspectiveCamera(75, 1.5, 0.1, 1000);
      const weaponView = createWeaponView(camera);

      expect(weaponView.weaponCamera).toBeInstanceOf(THREE.PerspectiveCamera);
      expect(weaponView.weaponCamera.parent).toBe(camera);
      expect(weaponView.weaponCamera.position.equals(new THREE.Vector3(0, 0, 0))).toBe(true);
    });

    it('renders only the weapon layer', () => {
      const camera = new THREE.PerspectiveCamera();
      const weaponView = createWeaponView(camera);

      expect(weaponView.weaponCamera.layers.isEnabled(WEAPON_LAYER)).toBe(true);
      expect(weaponView.weaponCamera.layers.isEnabled(0)).toBe(false);
    });

    it('uses a tight near/far frustum, much shorter than the main camera\'s', () => {
      const camera = new THREE.PerspectiveCamera(75, 1.5, 0.1, 1000);
      const weaponView = createWeaponView(camera);

      expect(weaponView.weaponCamera.near).toBeGreaterThan(0);
      expect(weaponView.weaponCamera.far).toBeLessThan(10);
      expect(weaponView.weaponCamera.far).toBeLessThan(camera.far);
    });

    it('keeps fov and aspect synced to the main camera as they change, on update', () => {
      const camera = new THREE.PerspectiveCamera(75, 1.5, 0.1, 1000);
      const weaponView = createWeaponView(camera);

      camera.fov = 90;
      camera.aspect = 2;
      camera.updateProjectionMatrix();
      weaponView.update(0);

      expect(weaponView.weaponCamera.fov).toBe(90);
      expect(weaponView.weaponCamera.aspect).toBe(2);
    });
  });
});
