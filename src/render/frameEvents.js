import { LOCAL_PLAYER_ID } from '../sim/entityIds.js';
import { computeAngleFromPlayer } from './feedback.js';
import { shooterIdsThatHit } from './impacts.js';

// Exists so the tick's per-event gameplay effects (tracers, impacts,
// gunshots, killfeed, damage indicator) can be triggered and tested without
// pulling in main.js's entire composition-root state.
export function applyFrameEvents(
  events,
  {
    weaponView,
    gunshots,
    debugMode,
    debugCounters,
    bots,
    tracers,
    impacts,
    decals,
    sim,
    hud,
    killfeed,
    playerEntity,
    damageIndicator,
    grenadeFX,
  }
) {
  // Resolved up front because the impact spark's colour depends on whether
  // the shot landed on someone, and the 'hit' event that says so is pushed
  // after the 'fire' event it belongs to.
  const landedShooters = shooterIdsThatHit(events);

  for (const event of events) {
    if (event.type === 'fire' && event.shooterId === LOCAL_PLAYER_ID) {
      weaponView.fire();
      // R10: MG shots sound distinct from pistol shots -- resolved from
      // the shooter's *current* heldWeapon, which is accurate for every
      // shot except the one that empties the last round (weapon.js's
      // auto-revert already flipped it back to 'pistol' by the time this
      // event is read); a one-shot cosmetic edge case, not a correctness
      // one.
      gunshots.playLocal(sim.world.getEntity(event.shooterId)?.heldWeapon);
      if (debugMode) debugCounters.fires += 1;
    }
    if (event.type === 'fire') {
      bots.find((b) => b.id === event.shooterId)?.animatedCharacter?.playFireReaction();
      tracers.spawn(event.origin, event.endPoint);
      const landedOnEntity = landedShooters.has(event.shooterId);
      impacts.spawn(event.endPoint, landedOnEntity ? 'body' : 'surface');
      // KTD2: decals mark world surfaces only -- a shot that landed on an
      // entity this tick is already covered by the 'body' impact spark
      // above, so skip the arena raycast entirely rather than let it
      // (possibly) land a decal on whatever's directly behind the target.
      if (!landedOnEntity) decals.spawnFromFireEvent(event.origin, event.endPoint);
      // event.origin is the shooter's own eye position, so it doubles as
      // where the shot should be heard from.
      if (event.shooterId !== LOCAL_PLAYER_ID) {
        gunshots.playAt(event.origin, sim.world.getEntity(event.shooterId)?.heldWeapon);
      }
    }
    if (event.type === 'hit' && event.shooterId === LOCAL_PLAYER_ID) {
      hud.flashCrosshair(event.killed ? 'kill' : 'hit');
      if (debugMode) debugCounters.crosshairFlashes += 1;
    }
    // R1, R3, R5: every kill narrates the feed, bot-vs-bot included; a
    // non-lethal hit is a no-op (addEntry checks event.killed itself).
    // Two blast kills in the same events array each call this in turn, so
    // they land as adjacent newest-first lines without any batching logic
    // here (AE2).
    if (event.type === 'hit') killfeed.addKill(event);
    if (event.type === 'hit' && event.targetId === LOCAL_PLAYER_ID && event.damageOrigin) {
      const angle = computeAngleFromPlayer(
        playerEntity.latest.position,
        playerEntity.latest.yaw,
        event.damageOrigin
      );
      damageIndicator.show(angle);
      if (debugMode) debugCounters.damageIndicatorShows += 1;
    }
    // R11: visible burst plus light flash, and an audible blast -- U4's
    // grenades.js pushes exactly one 'explosion' event per detonation, so
    // "once per blast" falls out of iterating events once rather than
    // needing dedup logic here.
    if (event.type === 'explosion') {
      grenadeFX.spawnExplosion(event.position);
      gunshots.playExplosion(event.position);
    }
  }
}
