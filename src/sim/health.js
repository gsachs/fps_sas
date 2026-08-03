// Damage, death, and respawn (R1, R3). A hit reduces health; at zero the
// entity dies, the shooter scores, and respawn is scheduled after a fixed
// delay -- restoring full health and continuing arena state, not resetting
// it (AE2).
import { creditKill } from './score.js';

const DAMAGE_PER_HIT = 20;
const RESPAWN_DELAY_TICKS = 180; // 3s at a 60Hz tick rate

export function createHealthSystem({ pickSpawnPoint, spawnPoints, movementSystem }) {
  const respawnTicksRemaining = new Map(); // entityId -> ticks left until respawn

  // Returns a hit event ({ shooterId, targetId, damage, killed,
  // targetPosition, shooterPosition }) for observers (HUD feedback in U7),
  // or null if the hit didn't apply (target already dead).
  function applyHit(entityAccessor, targetId, shooterId) {
    const target = entityAccessor.getEntity(targetId);
    if (!target || target.dead) return null;

    const shooter = shooterId ? entityAccessor.getEntity(shooterId) : null;
    const targetPosition = { ...target.position };
    const shooterPosition = shooter ? { ...shooter.position } : null;

    target.health -= DAMAGE_PER_HIT;
    let killed = false;

    if (target.health <= 0) {
      target.health = 0;
      target.dead = true;
      target.animHint = 'dead';
      killed = true;
      respawnTicksRemaining.set(targetId, RESPAWN_DELAY_TICKS);
      creditKill(shooter, target);
    }

    return { shooterId, targetId, damage: DAMAGE_PER_HIT, killed, targetPosition, shooterPosition };
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

      const spawn = pickSpawnPoint(spawnPoints, occupiedPositions);
      entity.position = { ...spawn };
      entity.health = 100;
      entity.dead = false;
      entity.animHint = 'idle';
      movementSystem.teleport(entityId, spawn);
    }
  }

  function isRespawning(entityId) {
    return respawnTicksRemaining.has(entityId);
  }

  function getRespawnTicksRemaining(entityId) {
    return respawnTicksRemaining.get(entityId) ?? 0;
  }

  return { applyHit, tickRespawns, isRespawning, getRespawnTicksRemaining, RESPAWN_DELAY_TICKS };
}
