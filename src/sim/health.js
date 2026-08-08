// Damage, death, and respawn (R1, R3). A hit reduces health; at zero the
// entity dies, the shooter scores, and respawn is scheduled after a fixed
// delay -- restoring full health and continuing arena state, not resetting
// it (AE2).
import { creditKill } from './score.js';
import { selectSpawnPoint } from '../arena/spawnPlacement.js';
import { DEFAULT_WEAPON_ID } from './weapon.js';

const DEFAULT_DAMAGE_PER_HIT = 20; // legacy fallback for callers that omit a damage value; no current caller does
const RESPAWN_DELAY_TICKS = 180; // 3s at a 60Hz tick rate
// Full health (U18): the one place this value is declared -- a new entity's
// initial health, a respawn/match-reset heal, and bot AI's respawn-detection
// heuristic (fsm.js) all import this instead of re-typing 100, so they can
// never drift out of lockstep with each other.
export const MAX_HEALTH = 100;
// Where a corpse's physics collider goes for the respawn window (mirrors
// main.js's PARK_POSITION for un-ramped bots). Collider.setEnabled() does
// not reliably exclude a kinematic character's collider from castRay in
// this Rapier build (verified: isEnabled() reports false, castRay still
// hits it) -- teleporting it away is what main.js's parked-bot idiom
// already relies on instead, and it's proven to work. Far enough below the
// arena that no hitscan ray reaches it (HITSCAN_MAX_DISTANCE is 100) and
// entity.position (render/mesh, kept at the death spot) is untouched --
// only the physics body moves.
const CORPSE_PARK_POSITION = { x: 0, y: -100, z: 0 };

// Reinforcements arrive by drop rather than materialising on the floor. The
// descent is real simulation, not a render flourish: entity.position is what
// the collider is teleported to each tick, so a falling bot can be shot on
// the way down and its hitbox is exactly where it looks. Driving this from
// the render layer instead would put the visible bot and its hitbox in
// different places -- the same decoupling that made recoil miss.
export const AIRDROP_HEIGHT = 14; // above the spawn point; clears every wall in the arena (WALL_HEIGHT 4)
const AIRDROP_DESCENT_PER_TICK = 0.3; // 18 units/sec at 60Hz, so a drop lands in ~0.8s

export function createHealthSystem({ rapierWorld, spawnPoints, movementSystem }) {
  const respawnTicksRemaining = new Map(); // entityId -> ticks left until respawn
  const airdropGroundY = new Map(); // entityId -> the y it is descending to

  // Puts `entity` in the air above `spawn` and starts its descent. Shared by
  // respawns and by the ramp unlocking a reinforcement, so both arrivals
  // look the same rather than one dropping in and the other appearing.
  function beginAirdrop(entity, spawn) {
    entity.position = { ...spawn, y: spawn.y + AIRDROP_HEIGHT };
    // Read by gatherCommands to withhold this bot's command while it falls:
    // it can be shot on the way down but cannot acquire or shoot back.
    entity.airdropping = true;
    airdropGroundY.set(entity.id, spawn.y);
    movementSystem.teleport(entity.id, entity.position);
  }

  // Advances every descent by one tick. Kept in the sim beside the respawn
  // timer, not in the render loop, for the reason beginAirdrop explains.
  function tickAirdrops(entityAccessor) {
    for (const [entityId, groundY] of airdropGroundY) {
      const entity = entityAccessor.getEntity(entityId);
      // Killed mid-drop, or cleared by a match reset: stop descending a
      // body that is no longer arriving.
      if (!entity || entity.dead) {
        airdropGroundY.delete(entityId);
        if (entity) entity.airdropping = false;
        continue;
      }
      const nextY = Math.max(groundY, entity.position.y - AIRDROP_DESCENT_PER_TICK);
      entity.position = { ...entity.position, y: nextY };
      movementSystem.teleport(entityId, entity.position);
      if (nextY <= groundY) {
        airdropGroundY.delete(entityId);
        entity.airdropping = false;
      }
    }
  }

  // Returns a hit event ({ shooterId, targetId, damage, killed, weapon,
  // targetPosition, shooterPosition, damageOrigin }) for observers (HUD
  // feedback, damage indicator, killfeed), or null if the hit didn't apply
  // (target already dead). `damage` is the caller's resolved per-weapon
  // amount (KTD1) -- callers that omit it get DEFAULT_DAMAGE_PER_HIT;
  // `weapon` (R7, KTD4) is the weapon identifier the caller resolved it
  // from, and callers that omit it get the default weapon id, so every hit
  // event carries a weapon even before every call site is updated. `damageOrigin`
  // is where the damage indicator should point from; for this hitscan path
  // it's always the shooter's live position (same value as
  // `shooterPosition`), but it's a distinct field because a future
  // projectile source (e.g. a grenade blast) will supply an origin that
  // isn't the shooter's current position.
  function applyHit(entityAccessor, targetId, shooterId, damage = DEFAULT_DAMAGE_PER_HIT, weapon = DEFAULT_WEAPON_ID) {
    const target = entityAccessor.getEntity(targetId);
    if (!target || target.dead) return null;

    const shooter = shooterId ? entityAccessor.getEntity(shooterId) : null;
    const targetPosition = { ...target.position };
    const shooterPosition = shooter ? { ...shooter.position } : null;
    const damageOrigin = shooterPosition;

    target.health -= damage;
    let killed = false;

    if (target.health <= 0) {
      target.health = 0;
      target.dead = true;
      target.animHint = 'dead';
      killed = true;
      respawnTicksRemaining.set(targetId, RESPAWN_DELAY_TICKS);
      creditKill(shooter, target);
      // Take the corpse's collider out of the physics world for the
      // respawn window -- otherwise it (mesh hidden, hitbox still solid)
      // keeps blocking bullets and line-of-sight sensing at the death
      // spot, and can poison spawn-safety checks that rate a point
      // "hidden" only because a corpse happens to occlude the ray.
      movementSystem.teleport(targetId, CORPSE_PARK_POSITION);
    }

    return { shooterId, targetId, damage, killed, weapon, targetPosition, shooterPosition, damageOrigin };
  }

  // Advances every pending respawn timer by one tick; respawns any entity
  // whose timer elapses. Call once per sim tick, after this tick's hits.
  function tickRespawns(entityAccessor, occupiedPositions) {
    for (const [entityId, remaining] of respawnTicksRemaining) {
      if (remaining > 1) {
        respawnTicksRemaining.set(entityId, remaining - 1);
        continue;
      }

      respawnTicksRemaining.delete(entityId);
      const entity = entityAccessor.getEntity(entityId);
      if (!entity) continue;

      // occupiedPositions is every currently-living entity -- exactly R11's
      // "enemy" set (KTD4), and the respawning entity is itself dead until
      // this call finishes, so it's never in its own way here.
      const spawn = selectSpawnPoint(rapierWorld, spawnPoints, {
        enemyPositions: occupiedPositions,
        occupiedPositions,
      });
      entity.health = MAX_HEALTH;
      entity.dead = false;
      entity.animHint = 'idle';
      // Also pulls the collider back out of CORPSE_PARK_POSITION -- it just
      // arrives above the spawn point rather than on it, and falls the rest
      // of the way under tickAirdrops.
      beginAirdrop(entity, spawn);
    }
  }

  function isRespawning(entityId) {
    return respawnTicksRemaining.has(entityId);
  }

  function getRespawnTicksRemaining(entityId) {
    return respawnTicksRemaining.get(entityId) ?? 0;
  }

  // Cancels a pending respawn timer without respawning the entity -- for
  // match-reset (U8), where the entity is about to be repositioned by the
  // reset itself, and a stale timer firing afterward would move it again
  // mid-new-match.
  function clearRespawnTimer(entityId) {
    respawnTicksRemaining.delete(entityId);
  }

  return {
    applyHit,
    tickRespawns,
    beginAirdrop,
    tickAirdrops,
    isRespawning,
    getRespawnTicksRemaining,
    clearRespawnTimer,
    RESPAWN_DELAY_TICKS,
  };
}
