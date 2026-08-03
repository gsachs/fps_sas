// Match lifecycle (F3): the match-end condition and the play-again reset.
// KTD7: first-to-N kills, timer left as a later addition.
import { getLeaderboard } from '../sim/score.js';

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
export function resetMatch(entityAccessor, { spawnPoints, pickSpawnPoint, movementSystem, healthSystem }) {
  const assignedSpawns = [];
  for (const entity of entityAccessor.allEntities()) {
    const spawn = pickSpawnPoint(spawnPoints, assignedSpawns);
    assignedSpawns.push(spawn);

    entity.position = { ...spawn };
    entity.health = 100;
    entity.dead = false;
    entity.animHint = 'idle';
    entity.score = 0;

    movementSystem.teleport(entity.id, spawn);
    healthSystem.clearRespawnTimer(entity.id);
  }
}
