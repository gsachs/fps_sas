// Scoring (R1) and the ranked view later units (U8's results screen) read.
export function creditKill(shooter, target) {
  if (!shooter || shooter === target) return;
  shooter.score += 1;
}

export function getLeaderboard(entityAccessor) {
  return entityAccessor
    .allEntities()
    .map((entity) => ({ id: entity.id, score: entity.score }))
    .sort((a, b) => b.score - a.score);
}
