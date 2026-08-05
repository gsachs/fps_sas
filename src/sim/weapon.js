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
// weapon instead of branching per type. Machine-gun numbers are placeholder
// constants -- clearly faster and weaker-per-shot than the pistol, tuned for
// real in U6; `spread` is carried here but has no effect yet, since no
// held-fire input path exists to jitter a shot's direction until U2.
const PISTOL_COOLDOWN_TICKS = 6; // ~10 shots/sec at a 60Hz tick rate
const PISTOL_DAMAGE = 20;
const PISTOL_SPREAD_RADIANS = 0;

const MACHINEGUN_COOLDOWN_TICKS = 2; // ~30 shots/sec: faster than the pistol
const MACHINEGUN_DAMAGE = 12; // less per shot than the pistol; DPS wins on rate
const MACHINEGUN_SPREAD_RADIANS = 0.03;

const WEAPON_CONFIGS = {
  pistol: { cooldownTicks: PISTOL_COOLDOWN_TICKS, damage: PISTOL_DAMAGE, spread: PISTOL_SPREAD_RADIANS },
  machinegun: {
    cooldownTicks: MACHINEGUN_COOLDOWN_TICKS,
    damage: MACHINEGUN_DAMAGE,
    spread: MACHINEGUN_SPREAD_RADIANS,
  },
};
const DEFAULT_WEAPON_ID = 'pistol'; // entities with no heldWeapon field fire as today's pistol

export function createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks }) {
  const remainingCooldown = new Map(); // entityId -> ticks left before next shot allowed

  // A ctor-level cooldown override forces only the pistol's cooldown (fast
  // test iteration, e.g. cooldownTicks: 0) -- the machine gun keeps its own
  // registry entry regardless, so overriding one weapon never masks the
  // other's config.
  const weaponConfigs =
    cooldownTicks === undefined
      ? WEAPON_CONFIGS
      : { ...WEAPON_CONFIGS, pistol: { ...WEAPON_CONFIGS.pistol, cooldownTicks } };

  // Resolves a hitscan shot for `entity` if its command requests fire and
  // its cooldown allows it. Returns { fired, hitEntityId, origin, endPoint,
  // damage } -- `fired` is true whenever the weapon actually discharges
  // this tick (hit or miss), so callers can trigger fire feedback (recoil,
  // muzzle flash, tracers) even on a miss; `hitEntityId` is the hit
  // entity's id, or null (miss, blocked by cover, on cooldown, or not
  // firing). `origin` and `endPoint` describe the ray's path (muzzle to hit
  // point, or to max range on a miss) so the render layer can draw a tracer
  // without recomputing this geometry itself. `damage` is the firing
  // entity's resolved weapon damage, carried back so callers (world.js)
  // don't have to re-resolve the same config to apply a hit.
  function resolveFire(entity, command) {
    const config = weaponConfigs[entity.heldWeapon ?? DEFAULT_WEAPON_ID] ?? weaponConfigs[DEFAULT_WEAPON_ID];

    const cooldown = remainingCooldown.get(entity.id) ?? 0;
    if (cooldown > 0) remainingCooldown.set(entity.id, cooldown - 1);

    if (!command.buttons.fire) return { fired: false, hitEntityId: null };
    if ((remainingCooldown.get(entity.id) ?? 0) > 0) return { fired: false, hitEntityId: null };

    remainingCooldown.set(entity.id, config.cooldownTicks);

    const shooterCollider = movementSystem.getCollider(entity.id);
    const origin = { x: entity.position.x, y: entity.position.y + EYE_HEIGHT, z: entity.position.z };
    const direction = {
      x: Math.sin(entity.yaw) * Math.cos(entity.pitch),
      y: Math.sin(entity.pitch),
      z: Math.cos(entity.yaw) * Math.cos(entity.pitch),
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
    return { fired: true, hitEntityId, origin, endPoint, damage: config.damage };
  }

  return { resolveFire };
}
