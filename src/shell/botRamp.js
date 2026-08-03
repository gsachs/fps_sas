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
