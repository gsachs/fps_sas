// Ramps how many bots are active over a match instead of starting at full
// strength -- playtest feedback said N bots converging from the start felt
// overwhelming rather than a fair fight to learn. Match-level orchestration
// (which/how-many bots to spawn), not per-bot AI, so this lives alongside
// matchEnd.js rather than in sim/bot/difficulty.js.
const INITIAL_ACTIVE_BOTS = 2;
const RAMP_INTERVAL_SECONDS = 20;

export function getActiveBotCount(elapsedSeconds, maxBots) {
  const unlocked = INITIAL_ACTIVE_BOTS + Math.floor(elapsedSeconds / RAMP_INTERVAL_SECONDS);
  return Math.min(unlocked, maxBots);
}

// The occupied-position list a ramp reinforcement's spawn selection must
// avoid. Every live entity except the one being placed -- matching the
// convention world.js's own respawn handling already uses. Building this
// from active bots only (as an earlier version did) left the player
// invisible to spawn selection, so a reinforcement could land exactly on
// the player's position.
export function buildOccupiedPositions(entities, excludeEntityId) {
  return entities.filter((entity) => !entity.dead && entity.id !== excludeEntityId).map((entity) => entity.position);
}
