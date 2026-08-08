// Everything a thrown grenade looks like (R11): a persistent mesh that
// tracks it from throw to detonation, then the burst and light flash that
// mark where it went off. Two different lifecycles live in one module
// because they're the same story told in two acts, not because they share
// mechanism -- the in-flight mesh is a toggled member of a fixed pool (the
// pickupMeshes.js idiom, keyed by a changing set of grenade ids instead of a
// fixed one), while the burst/light are transient effects that expire on
// their own clock (the impacts.js idiom).
import * as THREE from 'three';
import { GRENADE_POCKET_CAPACITY } from '../sim/pickups.js';
import { radialGlowTextureData } from './shotTextures.js';
import { GRENADE_PROJECTILE_MODEL } from './modelAssets.js';
import { loadPropModel } from './models.js';

const GRENADE_MESH_RADIUS = 0.15;
const GRENADE_MESH_COLOR = 0x3a3f2e; // dark, inert -- distinct from the pickup box's brighter green so a live throw doesn't read as another pickup

// Mirrors main.js's own `assetUrl` and pickupMeshes.js's copy of it, for the
// same reason that module gives: this module starts its own load rather than
// taking a resolved URL, so its call site does not change shape to launch
// one. BASE_URL-relative, so a subpath deployment still resolves.
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;
// Only the player carries grenades (R7); a throw spends one pocket slot
// before the projectile is ever added to grenades.js's in-flight map, so
// GRENADE_POCKET_CAPACITY is already the true ceiling on how many can be
// airborne at once under today's rules -- more than that is impossible, not
// just unlikely. syncInFlight grows the pool on demand anyway (see below) as
// a cheap defensive floor against that assumption changing later (e.g. bots
// someday throwing too), not because this cap is expected to bind.
const GRENADE_MESH_POOL_SIZE = GRENADE_POCKET_CAPACITY;

// An explosion is a bigger, farther-reaching event than a bullet impact and
// should read as one: longer-lived and larger than impacts.js's spark
// (IMPACT_LIFETIME_SECONDS 0.18, END_RADIUS 0.2) and brighter/longer than
// weaponView.js's muzzle flash (MUZZLE_FLASH_SECONDS 0.07, intensity 9).
const EXPLOSION_LIFETIME_SECONDS = 0.3;
const EXPLOSION_BURST_START_RADIUS = 0.15;
const EXPLOSION_BURST_END_RADIUS = 3; // scaled toward grenades.js's BLAST_RADIUS (8), not impacts.js's tiny END_RADIUS, so the burst's reach reads like the blast's real reach
const EXPLOSION_COLOR = 0xff8438;
const EXPLOSION_LIGHT_COLOR = 0xffb066;
const EXPLOSION_LIGHT_INTENSITY = 40; // vs weaponView's muzzle-flash intensity of 9 -- reads across a room, not just at arm's length
const EXPLOSION_LIGHT_DISTANCE = 20; // PointLight's own falloff radius, beyond BLAST_RADIUS (8) so nearby walls actually catch the flash
// Several simultaneous blasts is already an extreme case; oldest recycled,
// mirroring impacts.js's MAX_ACTIVE_IMPACTS.
const MAX_ACTIVE_EXPLOSIONS = 8;

// A camera-facing sprite on the same generated glow texture the muzzle flash
// and impact spark use (shotTextures.js), for the same reason: an
// icosahedron reads as a faceted solid, and at this one's end radius of 3 it
// was a six-sided orange lump six units across rather than a fireball. The
// burst is the one place that shape mattered most -- it is the largest thing
// on screen when it happens.
//
// Shared across every burst the same way the spark texture is; per-instance
// state (opacity, scale) lives on each sprite's own material and transform.
const BURST_TEXTURE_SIZE = 128; // larger than the spark's: this fills much more of the screen
const BURST_TEXTURE = new THREE.DataTexture(
  radialGlowTextureData(BURST_TEXTURE_SIZE),
  BURST_TEXTURE_SIZE,
  BURST_TEXTURE_SIZE
);
BURST_TEXTURE.colorSpace = THREE.SRGBColorSpace;
BURST_TEXTURE.needsUpdate = true;
const GRENADE_GEOMETRY = new THREE.IcosahedronGeometry(GRENADE_MESH_RADIUS, 0);
// No per-instance animation on a grenade mesh (it doesn't fade), so unlike
// the burst material this one is safely shared across the whole pool. Shared
// is also why a placeholder is never passed to disposeObject3D on swap-out:
// that walks the subtree freeing geometry and materials, which here would
// blank every other placeholder still in the pool.
const GRENADE_MATERIAL = new THREE.MeshStandardMaterial({ color: GRENADE_MESH_COLOR, roughness: 0.5 });

export function createGrenadeFX(scene) {
  const pool = []; // { mesh, assignedId: string|null }
  const slotByGrenadeId = new Map();
  const activeExplosions = [];

  // Set once the real model arrives; until then every slot shows the
  // placeholder solid. Held as a template so each slot gets its own clone --
  // a single Object3D cannot be in two places at once, and two grenades can
  // be airborne.
  let projectileTemplate = null;

  // Each slot's scene object is a Group, not the visual itself: syncInFlight
  // moves the group to the grenade's sim position every frame, while the
  // visual inside carries the model's own scale and recentring offset. That
  // separation is what lets the placeholder be swapped for the real model
  // mid-flight without syncInFlight knowing either exists.
  function projectileVisual() {
    if (!projectileTemplate) {
      const placeholder = new THREE.Mesh(GRENADE_GEOMETRY, GRENADE_MATERIAL);
      placeholder.castShadow = true;
      return placeholder;
    }
    const model = projectileTemplate.clone();
    model.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    return model;
  }

  function addPoolSlot() {
    const mesh = new THREE.Group();
    mesh.name = 'grenade';
    mesh.visible = false;
    mesh.add(projectileVisual());
    scene.add(mesh);
    const slot = { mesh, assignedId: null };
    pool.push(slot);
    return slot;
  }

  for (let i = 0; i < GRENADE_MESH_POOL_SIZE; i++) addPoolSlot();

  // Swaps every slot's placeholder for the real model once it loads, through
  // the same non-blocking, placeholder-on-failure shape pickupMeshes.js uses
  // (R18: a stalled or failed load leaves the solid in place and the game
  // stays playable). Slots created later pick the model up on their own via
  // projectileVisual. The outgoing placeholders are removed but never
  // disposed -- their geometry and material are shared pool-wide.
  loadPropModel(assetUrl(GRENADE_PROJECTILE_MODEL.path), {
    onError: (error) => console.warn('Failed to load grenade projectile model:', error),
  }).then((result) => {
    if (!result.loaded) return;
    const { offset, scale } = GRENADE_PROJECTILE_MODEL;
    projectileTemplate = result.scene;
    projectileTemplate.scale.setScalar(scale);
    projectileTemplate.position.set(offset.x, offset.y, offset.z);
    for (const slot of pool) {
      slot.mesh.clear();
      slot.mesh.add(projectileVisual());
    }
  });

  // Syncs the pool against grenades.js's current getInFlightGrenades()
  // snapshot: a live id keeps (or claims) a mesh and moves it to the
  // reported position; an id no longer present -- detonated, or cleared by
  // resetAll() -- gives its mesh back to the pool and hides it. Called every
  // frame with the live array, not diffed against the previous frame, so a
  // grenade that both landed and detonated between two frames still ends up
  // correctly hidden.
  function syncInFlight(grenades) {
    const presentIds = new Set(grenades.map((grenade) => grenade.id));

    for (const slot of pool) {
      if (slot.assignedId !== null && !presentIds.has(slot.assignedId)) {
        slotByGrenadeId.delete(slot.assignedId);
        slot.assignedId = null;
        slot.mesh.visible = false;
      }
    }

    for (const grenade of grenades) {
      let slot = slotByGrenadeId.get(grenade.id);
      if (!slot) {
        slot = pool.find((candidate) => candidate.assignedId === null) ?? addPoolSlot();
        slot.assignedId = grenade.id;
        slot.mesh.visible = true;
        slotByGrenadeId.set(grenade.id, slot);
      }
      slot.mesh.position.set(grenade.position.x, grenade.position.y, grenade.position.z);
    }
  }

  function retireExplosion(index) {
    const entry = activeExplosions[index];
    scene.remove(entry.burst);
    entry.burst.material.dispose(); // BURST_TEXTURE is shared and outlives every burst
    scene.remove(entry.light);
    activeExplosions.splice(index, 1);
  }

  // One burst plus one light flash per call -- main.js calls this once per
  // 'explosion' event, and grenades.js's detonate() only ever pushes one
  // such event per blast, so "once per event" falls out of that 1:1 wiring
  // rather than needing dedup logic here.
  function spawnExplosion(position) {
    if (activeExplosions.length >= MAX_ACTIVE_EXPLOSIONS) retireExplosion(0);

    const material = new THREE.SpriteMaterial({
      map: BURST_TEXTURE,
      color: EXPLOSION_COLOR,
      transparent: true,
      depthWrite: false,
    });
    const burst = new THREE.Sprite(material);
    burst.name = 'explosionBurst';
    burst.position.set(position.x, position.y, position.z);
    burst.scale.setScalar(EXPLOSION_BURST_START_RADIUS);
    scene.add(burst);

    // Added to the scene directly, not the camera group -- a blast lights
    // the world from its own position, unlike the muzzle flash it's modeled
    // on, which is anchored to the first-person view.
    const light = new THREE.PointLight(EXPLOSION_LIGHT_COLOR, EXPLOSION_LIGHT_INTENSITY, EXPLOSION_LIGHT_DISTANCE);
    light.name = 'explosionLight';
    light.position.set(position.x, position.y, position.z);
    scene.add(light);

    activeExplosions.push({ burst, light, remaining: EXPLOSION_LIFETIME_SECONDS });
  }

  function update(deltaSeconds) {
    for (let i = activeExplosions.length - 1; i >= 0; i--) {
      const entry = activeExplosions[i];
      entry.remaining -= deltaSeconds;
      if (entry.remaining <= 0) {
        retireExplosion(i);
        continue;
      }
      const elapsed = 1 - entry.remaining / EXPLOSION_LIFETIME_SECONDS;
      entry.burst.scale.setScalar(
        EXPLOSION_BURST_START_RADIUS + (EXPLOSION_BURST_END_RADIUS - EXPLOSION_BURST_START_RADIUS) * elapsed
      );
      entry.burst.material.opacity = 1 - elapsed;
      entry.light.intensity = EXPLOSION_LIGHT_INTENSITY * (1 - elapsed);
    }
  }

  return { syncInFlight, spawnExplosion, update };
}
