// Match lifecycle (F3): the match-end condition and the play-again reset.
// KTD7: first-to-N kills, timer left as a later addition.
import { getLeaderboard } from '../sim/score.js';
import { selectSpawnPoint } from '../arena/spawnPlacement.js';
import { DEFAULT_WEAPON_ID } from '../sim/weapon.js';
import { MAX_HEALTH } from '../sim/health.js';

// KTD6: raised alongside the bigger roster and faster MG kills, so a match
// doesn't run shorter than before despite both of those speeding up scoring.
export const KILLS_TO_WIN = 15;

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
// entity reverts to the default weapon with an empty grenade pocket. grenadeSystem
// (also optional, U4) clears every in-flight grenade and pending blast --
// distinct from grenadeCount below, which is per-entity pocket state the
// per-entity loop already zeroes; a mid-air grenade is a projectile, not a
// pocket, and needs its own clear hook (KTD5). killfeed (also optional)
// clears its entries the same way -- it only ages while a match plays, so
// without this the previous match's frozen lines would bleed into the new
// one. decals and corpses (both optional) clear every bullet mark and body
// left by the finished match, for the same
// reason -- R5 says they persist through a match, not across one.
export function resetMatch(
  entityAccessor,
  { rapierWorld, spawnPoints, movementSystem, healthSystem, pickupSystem, grenadeSystem, killfeed, decals, corpses }
) {
  if (pickupSystem) pickupSystem.resetAll();
  if (grenadeSystem) grenadeSystem.resetAll();
  if (killfeed) killfeed.resetAll();
  if (decals) decals.resetAll();
  if (corpses) corpses.resetAll();

  const assignedSpawns = [];
  for (const entity of entityAccessor.allEntities()) {
    const spawn = selectSpawnPoint(rapierWorld, spawnPoints, {
      enemyPositions: assignedSpawns,
      occupiedPositions: assignedSpawns,
    });
    assignedSpawns.push(spawn);

    entity.position = { ...spawn };
    entity.health = MAX_HEALTH;
    entity.dead = false;
    entity.animHint = 'idle';
    entity.score = 0;
    entity.heldWeapon = DEFAULT_WEAPON_ID;
    entity.grenadeCount = 0;

    movementSystem.teleport(entity.id, spawn);
    healthSystem.clearRespawnTimer(entity.id);
  }
}
