// Hitscan resolution (KTD3): a fire command becomes an instant raycast
// against the arena's collider world, resolved here inside the sim step so
// it stays lag-compensatable if Phase-2 adds server authority. A per-entity
// cooldown (in sim ticks) bounds fire rate independently of how many ticks
// a render frame runs -- a queued fire edge that arrives during cooldown is
// dropped, not banked, so rapid-clicking can't queue extra shots.
import RAPIER from '@dimforge/rapier3d-compat';
import { EYE_HEIGHT } from './movement.js';

const HITSCAN_MAX_DISTANCE = 100;

// Per-weapon behavior (KTD1): every weapon resolves from this registry by
// the shooting entity's `heldWeapon`, so one weapon system serves every
// weapon instead of branching per type. `heldFire` picks which Command field
// gates the trigger (KTD2): a held-fire weapon reads the continuous level
// (`fireHeld`) so it keeps firing every cooldown window the trigger stays
// down; an edge-fire weapon would gate on the discrete press (`fire`)
// instead -- no weapon currently uses that shape, but the branch stays live
// as a registry seam for the deferred weapon-archetypes pass (R6/R7's
// "arena now, flag next" plan: KTD2). `spread` jitters the fire angle per
// shot (see resolveFire).
const MACHINEGUN_COOLDOWN_TICKS = 2; // ~30 shots/sec
const MACHINEGUN_DAMAGE = 12;
export const MACHINEGUN_SPREAD_RADIANS = 0.03;

const WEAPON_CONFIGS = {
  machinegun: {
    cooldownTicks: MACHINEGUN_COOLDOWN_TICKS,
    damage: MACHINEGUN_DAMAGE,
    spread: MACHINEGUN_SPREAD_RADIANS,
    heldFire: true,
  },
};
export const DEFAULT_WEAPON_ID = 'machinegun'; // R6: every entity's default, infinite weapon
export const MACHINEGUN_WEAPON_ID = 'machinegun'; // sibling id constant (U12): every other module imports this instead of re-typing the literal

// Whether `weaponId` fires on the Command's held-fire level rather than its
// edge latch (KTD2) -- the one place that distinction is decided, so bot
// cadence (fsm.js) can ask it instead of hardcoding weapon names of its own.
export function isHeldFireWeapon(weaponId) {
  return Boolean((WEAPON_CONFIGS[weaponId] ?? WEAPON_CONFIGS[DEFAULT_WEAPON_ID]).heldFire);
}

export function createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks, random = Math.random }) {
  const remainingCooldown = new Map(); // entityId -> ticks left before next shot allowed

  // A ctor-level cooldown override forces the machine gun's cooldown (fast
  // test iteration, e.g. cooldownTicks: 0) without touching its other
  // config fields.
  const weaponConfigs =
    cooldownTicks === undefined
      ? WEAPON_CONFIGS
      : { ...WEAPON_CONFIGS, machinegun: { ...WEAPON_CONFIGS.machinegun, cooldownTicks } };

  // Resolves a hitscan shot for `entity` if its command requests fire (edge
  // or held level, per the weapon's config) and its cooldown allows it.
  // Returns { fired, hitEntityId, origin, endPoint, damage, weapon } --
  // `fired` is true whenever the weapon actually discharges this tick (hit
  // or miss), so callers can trigger fire feedback (recoil, muzzle flash,
  // tracers) even on a miss; `hitEntityId` is the hit entity's id, or null
  // (miss, blocked by cover, on cooldown, or not firing). `origin` and
  // `endPoint` describe the ray's path (muzzle to hit point, or to max range
  // on a miss) so the render layer can draw a tracer without recomputing
  // this geometry itself. `damage` is the firing entity's resolved weapon
  // damage, carried back so callers (world.js) don't have to re-resolve the
  // same config to apply a hit. `weapon` (R7) is the weapon id that fired
  // this shot, for the same callers to stamp onto the resulting kill event.
  function resolveFire(entity, command) {
    const weaponId = weaponConfigs[entity.heldWeapon] ? entity.heldWeapon : DEFAULT_WEAPON_ID;
    const config = weaponConfigs[weaponId];

    const cooldown = remainingCooldown.get(entity.id) ?? 0;
    if (cooldown > 0) remainingCooldown.set(entity.id, cooldown - 1);

    // KTD2: a held-fire weapon (the machine gun) gates on the continuous
    // level instead of the edge latch, so it keeps firing every cooldown
    // window the trigger stays down -- no per-weapon branching beyond this
    // one lookup.
    const triggerActive = config.heldFire ? command.buttons.fireHeld : command.buttons.fire;
    if (!triggerActive) return { fired: false, hitEntityId: null };
    if ((remainingCooldown.get(entity.id) ?? 0) > 0) return { fired: false, hitEntityId: null };

    remainingCooldown.set(entity.id, config.cooldownTicks);

    const shooterCollider = movementSystem.getCollider(entity.id);
    const origin = { x: entity.position.x, y: entity.position.y + EYE_HEIGHT, z: entity.position.z };
    // Spread jitters the input angle before the direction vector is built,
    // never the already-computed direction itself: deflecting an output
    // vector is the class of bug this repo already hit once (see
    // docs/solutions/logic-errors/bot-obstacle-avoidance-reversal.md), and
    // jittering yaw/pitch up front feeds the exact same verified basis
    // formula below (docs/solutions/logic-errors/
    // strafe-direction-camera-basis-mismatch.md) completely untouched.
    const jitteredYaw = entity.yaw + (config.spread > 0 ? (random() * 2 - 1) * config.spread : 0);
    const jitteredPitch = entity.pitch + (config.spread > 0 ? (random() * 2 - 1) * config.spread : 0);
    const direction = {
      x: Math.sin(jitteredYaw) * Math.cos(jitteredPitch),
      y: Math.sin(jitteredPitch),
      z: Math.cos(jitteredYaw) * Math.cos(jitteredPitch),
    };

    const hit = rapierWorld.castRay(
      new RAPIER.Ray(origin, direction),
      HITSCAN_MAX_DISTANCE,
      true,
      undefined,
      undefined,
      shooterCollider
    );

    const hitEntityId = hit ? movementSystem.getEntityIdForCollider(hit.collider) ?? null : null;
    const distance = hit ? hit.timeOfImpact : HITSCAN_MAX_DISTANCE;
    const endPoint = {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance,
    };

    return { fired: true, hitEntityId, origin, endPoint, damage: config.damage, weapon: weaponId };
  }

  return { resolveFire };
}
