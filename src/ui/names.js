// R6: one display-name rule for every entity, shared by the results screen
// and the killfeed -- so "You" / "Bot N" never drifts between the two
// (KTD3).
import { LOCAL_PLAYER_ID } from '../sim/entityIds.js';

const BOT_ID_PATTERN = /^bot(\d+)$/;

// entityId -> "You" (the local player), "Bot N" (1-based, matching the
// bot0/bot1/... entity ids main.js assigns), or the id itself for anything
// else -- never null, so a caller can always render the result directly.
export function displayName(entityId) {
  if (entityId === LOCAL_PLAYER_ID) return 'You';
  const match = BOT_ID_PATTERN.exec(entityId);
  if (match) return `Bot ${Number(match[1]) + 1}`;
  return entityId;
}
