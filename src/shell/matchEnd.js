// Match lifecycle (F3): the match-end condition and the play-again reset.
// KTD7: first-to-N kills, timer left as a later addition.
import { getLeaderboard } from '../sim/score.js';
import { selectSpawnPoint } from '../arena/spawnPlacement.js';

export const KILLS_TO_WIN = 10; // tuned during playtest (Outstanding Questions)

export function checkMatchEnd(entityAccessor) {
  const leaderboard = getLeaderboard(entityAccessor);
  const leader = leaderboard[0];
  return { ended: Boolean(leader && leader.score >= KILLS_TO_WIN), leaderboard };
}

// Play-again (R13): resets every entity's score, health, and position for a
// fresh match -- distinct from in-match respawn, which continues state
// (AE2). Also cancels any pending respawn timers so a stale one can't fire
// mid-new-match and reposition an already-reset entity.
//
// R11: placing each entity out of every already-placed entity's sight, in
// turn, also gives the whole set mutual invisibility for free -- line of
// sight is symmetric, so "the new entity can't see anyone placed so far"
// and "no one placed so far can see the new entity" are the same fact.
//
// R8: also restores the armory economy -- every pickup returns (via
// pickupSystem, optional so callers that predate U3 keep working) and every
// entity reverts to the pistol with an empty grenade pocket.
export function resetMatch(
  entityAccessor,
  { rapierWorld, spawnPoints, movementSystem, healthSystem, pickupSystem }
) {
  if (pickupSystem) pickupSystem.resetAll();

  const assignedSpawns = [];
  for (const entity of entityAccessor.allEntities()) {
    const spawn = selectSpawnPoint(rapierWorld, spawnPoints, {
      enemyPositions: assignedSpawns,
      occupiedPositions: assignedSpawns,
    });
    assignedSpawns.push(spawn);

    entity.position = { ...spawn };
    entity.health = 100;
    entity.dead = false;
    entity.animHint = 'idle';
    entity.score = 0;
    entity.heldWeapon = 'pistol';
    entity.ammo = null;
    entity.grenadeCount = 0;

    movementSystem.teleport(entity.id, spawn);
    healthSystem.clearRespawnTimer(entity.id);
  }
}
