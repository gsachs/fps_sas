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
// gates the trigger (KTD2): the pistol stays on the edge latch (`fire`), the
// machine gun reads the continuous level (`fireHeld`) so it keeps firing
// every cooldown window the trigger stays down. `spread` jitters the fire
// angle per shot (see resolveFire); `maxAmmo` is what an eventual pickup
// grants (U3) -- only the machine gun carries one, since the pistol is
// infinite.
const PISTOL_COOLDOWN_TICKS = 6; // ~10 shots/sec at a 60Hz tick rate
const PISTOL_DAMAGE = 20;
const PISTOL_SPREAD_RADIANS = 0;

const MACHINEGUN_COOLDOWN_TICKS = 2; // ~30 shots/sec: faster than the pistol
const MACHINEGUN_DAMAGE = 12; // less per shot than the pistol; DPS wins on rate
export const MACHINEGUN_SPREAD_RADIANS = 0.03;
// Placeholder magazine size (U2): finite enough to force the auto-revert
// loop within a short spray so the loop is playable today; real balance is
// U6's job once the pickup economy (U3) exists to make "how often can I
// refill" part of the tuning question.
export const MACHINEGUN_MAX_AMMO = 48;

const WEAPON_CONFIGS = {
  pistol: {
    cooldownTicks: PISTOL_COOLDOWN_TICKS,
    damage: PISTOL_DAMAGE,
    spread: PISTOL_SPREAD_RADIANS,
    heldFire: false,
  },
  machinegun: {
    cooldownTicks: MACHINEGUN_COOLDOWN_TICKS,
    damage: MACHINEGUN_DAMAGE,
    spread: MACHINEGUN_SPREAD_RADIANS,
    heldFire: true,
    maxAmmo: MACHINEGUN_MAX_AMMO,
  },
};
export const DEFAULT_WEAPON_ID = 'pistol'; // entities with no heldWeapon field fire as today's pistol

// Whether `weaponId` fires on the Command's held-fire level rather than its
// edge latch (KTD2) -- the one place that distinction is decided, so bot
// cadence (fsm.js) can ask it instead of hardcoding weapon names of its own.
export function isHeldFireWeapon(weaponId) {
  return Boolean((WEAPON_CONFIGS[weaponId] ?? WEAPON_CONFIGS[DEFAULT_WEAPON_ID]).heldFire);
}

export function createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks, random = Math.random }) {
  const remainingCooldown = new Map(); // entityId -> ticks left before next shot allowed

  // A ctor-level cooldown override forces only the pistol's cooldown (fast
  // test iteration, e.g. cooldownTicks: 0) -- the machine gun keeps its own
  // registry entry regardless, so overriding one weapon never masks the
  // other's config.
  const weaponConfigs =
    cooldownTicks === undefined
      ? WEAPON_CONFIGS
      : { ...WEAPON_CONFIGS, pistol: { ...WEAPON_CONFIGS.pistol, cooldownTicks } };

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
    // Captured before any mutation below (the auto-revert reassigns
    // entity.heldWeapon later in this same function) -- R7's kill event
    // needs the weapon that actually fired the shot, not whatever the
    // entity holds by the time this returns.
    const weaponId = weaponConfigs[entity.heldWeapon] ? entity.heldWeapon : DEFAULT_WEAPON_ID;
    const config = weaponConfigs[entity.heldWeapon ?? DEFAULT_WEAPON_ID] ?? weaponConfigs[DEFAULT_WEAPON_ID];

    const cooldown = remainingCooldown.get(entity.id) ?? 0;
    if (cooldown > 0) remainingCooldown.set(entity.id, cooldown - 1);

    // KTD2: the pistol keeps its edge-triggered latch (one press, one
    // shot); a held-fire weapon (the machine gun) gates on the continuous
    // level instead, so it keeps firing every cooldown window the trigger
    // stays down -- no per-weapon branching beyond this one lookup.
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

    // R1's auto-revert: a finite-ammo weapon (the machine gun) that just
    // spent its last round returns the entity to the infinite pistol this
    // same tick, no separate input needed -- entity.ammo returns to null so
    // it still reads as "infinite" once heldWeapon is back to the pistol.
    if (Number.isFinite(entity.ammo)) {
      entity.ammo -= 1;
      if (entity.ammo <= 0) {
        entity.ammo = null;
        entity.heldWeapon = DEFAULT_WEAPON_ID;
      }
    }

    return { fired: true, hitEntityId, origin, endPoint, damage: config.damage, weapon: weaponId };
  }

  return { resolveFire };
}
