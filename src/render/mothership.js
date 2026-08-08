// The landing itself. The quadcopters that deliver defenders all match are
// couriers; this is the thing they were couriers for, and it has to read as a
// different order of machine the moment it comes over the wall -- big, slow,
// and unbothered.
//
// Built from primitives for the same reasons the drone is (dropships.js):
// nothing in the asset set flies, a hull is a handful of boxes, and it
// matches the low-poly rigs already here. Cosmetic only -- it exists on the
// results screen, where the simulation has stopped, so it has no collider and
// interacts with nothing.
import * as THREE from 'three';

// Sized against the compound, not against the drone. The districts are
// roughly 20-26 units across, so a hull this long reads as something that
// could not have been carried in by anything the player has seen so far.
const HULL = { length: 26, width: 11, height: 3.2 };
const BRIDGE = { length: 7, width: 5, height: 1.6 };
const NACELLE_RADIUS = 1.5;
const NACELLE_LENGTH = 7;
const HULL_COLOR = 0x343a44;
const PANEL_COLOR = 0x596273;
const GLOW_COLOR = 0xffd39a;

// Comes in high enough to clear everything and settles well above the
// rooftops, so it hangs over the site rather than landing on it -- the fiction
// is that the site is now safe for it, not that the match continues.
const START_HEIGHT = 78;
const HOVER_HEIGHT = 23;
const APPROACH_DISTANCE = 150; // out beyond the fog, so it emerges rather than appears
const APPROACH_SECONDS = 16;

export function createMothership(scene) {
  let craft = null;
  let elapsed = 0;
  let approach = null;

  function build() {
    const group = new THREE.Group();
    group.name = 'mothership';
    const hullMaterial = new THREE.MeshStandardMaterial({ color: HULL_COLOR, roughness: 0.7, transparent: true });
    const panelMaterial = new THREE.MeshStandardMaterial({ color: PANEL_COLOR, roughness: 0.5, transparent: true });
    // Unlit, so the underside reads as running lights at any time of day
    // rather than going dark on the shadowed face like the hull does.
    const glowMaterial = new THREE.MeshBasicMaterial({ color: GLOW_COLOR, transparent: true });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(HULL.width, HULL.height, HULL.length), hullMaterial);
    hull.castShadow = true;
    group.add(hull);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE.width, BRIDGE.height, BRIDGE.length), panelMaterial);
    bridge.position.set(0, HULL.height / 2 + BRIDGE.height / 2, -HULL.length * 0.18);
    bridge.castShadow = true;
    group.add(bridge);

    // Four nacelles slung under the hull corners: the silhouette from
    // underneath is the only one the player ever gets, so the detail goes
    // where it will actually be seen.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const nacelle = new THREE.Mesh(
          new THREE.CylinderGeometry(NACELLE_RADIUS, NACELLE_RADIUS, NACELLE_LENGTH, 10),
          panelMaterial
        );
        nacelle.rotation.x = Math.PI / 2;
        nacelle.position.set(sx * HULL.width * 0.42, -HULL.height * 0.5, sz * HULL.length * 0.28);
        nacelle.castShadow = true;
        group.add(nacelle);

        const glow = new THREE.Mesh(new THREE.CircleGeometry(NACELLE_RADIUS * 0.8, 12), glowMaterial);
        glow.rotation.x = Math.PI / 2; // facing straight down
        glow.position.set(nacelle.position.x, nacelle.position.y - NACELLE_RADIUS * 0.7, nacelle.position.z);
        group.add(glow);
      }
    }

    return { group, materials: [hullMaterial, panelMaterial, glowMaterial] };
  }

  // Brings the mothership in over `centre`, inbound along `bearing`.
  function arrive(centre, bearing) {
    if (craft) return;
    craft = build();
    approach = {
      from: {
        x: centre.x + Math.sin(bearing) * APPROACH_DISTANCE,
        z: centre.z + Math.cos(bearing) * APPROACH_DISTANCE,
      },
      to: { x: centre.x, z: centre.z },
    };
    elapsed = 0;
    craft.group.position.set(approach.from.x, START_HEIGHT, approach.from.z);
    craft.group.rotation.y = Math.atan2(approach.to.x - approach.from.x, approach.to.z - approach.from.z);
    for (const material of craft.materials) material.opacity = 0;
    scene.add(craft.group);
  }

  function update(deltaSeconds) {
    if (!craft) return;
    elapsed += deltaSeconds;
    const t = Math.min(1, elapsed / APPROACH_SECONDS);
    // Ease-out on a long approach: it comes in fast from out past the fog and
    // slows as it arrives, which is what makes it feel heavy.
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    craft.group.position.x = approach.from.x + (approach.to.x - approach.from.x) * eased;
    craft.group.position.z = approach.from.z + (approach.to.z - approach.from.z) * eased;
    craft.group.position.y = START_HEIGHT + (HOVER_HEIGHT - START_HEIGHT) * eased;
    for (const material of craft.materials) material.opacity = Math.min(1, elapsed / 2);
  }

  // Where it currently is, for anything that needs to fire from it or point
  // at it. Null until it has arrived, never undefined (Core Invariant).
  function position() {
    return craft ? { x: craft.group.position.x, y: craft.group.position.y, z: craft.group.position.z } : null;
  }

  function reset() {
    if (!craft) return;
    scene.remove(craft.group);
    // Geometry here is per-instance (there is only ever one of these), so
    // unlike the shared drone parts it is safe to release outright.
    craft.group.traverse((node) => node.geometry?.dispose());
    for (const material of craft.materials) material.dispose();
    craft = null;
    approach = null;
  }

  return { arrive, update, position, reset, isPresent: () => craft !== null };
}
