import { describe, expect, it, vi } from 'vitest';
import { applyFrameEvents } from '../../src/render/frameEvents.js';
import { computeAngleFromPlayer } from '../../src/render/feedback.js';
import { LOCAL_PLAYER_ID } from '../../src/sim/entityIds.js';

// Builds the full set of collaborators applyFrameEvents dispatches to, all
// as vi.fn() spies -- this exercises only the dispatch logic (which mock
// gets called, with what), never a real render/audio implementation.
function buildCollaborators(overrides = {}) {
  return {
    weaponView: { fire: vi.fn() },
    gunshots: { playLocal: vi.fn(), playAt: vi.fn(), playExplosion: vi.fn() },
    debugMode: false,
    debugCounters: { fires: 0, crosshairFlashes: 0, damageIndicatorShows: 0 },
    bots: [],
    tracers: { spawn: vi.fn() },
    impacts: { spawn: vi.fn() },
    decals: { spawnFromFireEvent: vi.fn() },
    sim: { world: { getEntity: () => undefined } },
    hud: { flashCrosshair: vi.fn() },
    killfeed: { addKill: vi.fn() },
    playerEntity: { latest: { position: { x: 0, y: 0, z: 0 }, yaw: 0 } },
    damageIndicator: { show: vi.fn() },
    grenadeFX: { spawnExplosion: vi.fn() },
    ...overrides,
  };
}

describe('applyFrameEvents', () => {
  it("a 'fire' event from the local player calls weaponView.fire() and gunshots.playLocal()", () => {
    const collaborators = buildCollaborators({
      sim: { world: { getEntity: () => ({ heldWeapon: 'pistol' }) } },
    });
    const events = [{ type: 'fire', shooterId: LOCAL_PLAYER_ID, origin: { x: 0, y: 0, z: 0 }, endPoint: { x: 1, y: 0, z: 1 } }];

    applyFrameEvents(events, collaborators);

    expect(collaborators.weaponView.fire).toHaveBeenCalledTimes(1);
    expect(collaborators.gunshots.playLocal).toHaveBeenCalledWith('pistol');
    expect(collaborators.gunshots.playAt).not.toHaveBeenCalled();
  });

  it("a 'fire' event from a bot spawns a tracer/impact/decal and calls gunshots.playAt(), not playLocal()", () => {
    const collaborators = buildCollaborators({
      sim: { world: { getEntity: () => ({ heldWeapon: 'machinegun' }) } },
    });
    const origin = { x: 2, y: 0, z: 2 };
    const endPoint = { x: 5, y: 0, z: 5 };
    const events = [{ type: 'fire', shooterId: 'bot0', origin, endPoint }];

    applyFrameEvents(events, collaborators);

    expect(collaborators.tracers.spawn).toHaveBeenCalledWith(origin, endPoint);
    expect(collaborators.impacts.spawn).toHaveBeenCalledWith(endPoint, 'surface');
    expect(collaborators.decals.spawnFromFireEvent).toHaveBeenCalledWith(origin, endPoint);
    expect(collaborators.gunshots.playAt).toHaveBeenCalledWith(origin, 'machinegun');
    expect(collaborators.gunshots.playLocal).not.toHaveBeenCalled();
  });

  // KTD2: a shot that already landed on an entity this tick is covered by
  // impacts.js's 'body' spark -- the arena raycast is skipped entirely
  // rather than risk landing a decal on whatever's behind the target.
  it("a 'fire' event whose shooter also landed a 'hit' this tick does not raycast for a decal", () => {
    const collaborators = buildCollaborators();
    const origin = { x: 0, y: 0, z: 0 };
    const endPoint = { x: 1, y: 0, z: 1 };
    const events = [
      { type: 'fire', shooterId: 'bot0', origin, endPoint },
      { type: 'hit', shooterId: 'bot0', targetId: 'player' },
    ];

    applyFrameEvents(events, collaborators);

    expect(collaborators.impacts.spawn).toHaveBeenCalledWith(endPoint, 'body');
    expect(collaborators.decals.spawnFromFireEvent).not.toHaveBeenCalled();
  });

  it("a 'hit' event calls killfeed.addKill()", () => {
    const collaborators = buildCollaborators();
    const hitEvent = { type: 'hit', shooterId: 'bot0', targetId: 'bot1', killed: true };

    applyFrameEvents([hitEvent], collaborators);

    expect(collaborators.killfeed.addKill).toHaveBeenCalledWith(hitEvent);
  });

  it("a 'hit' event targeting the local player with a damageOrigin calls damageIndicator.show() with a computed angle", () => {
    const playerEntity = { latest: { position: { x: 0, y: 0, z: 0 }, yaw: 0 } };
    const damageOrigin = { x: 3, y: 0, z: 4 };
    const collaborators = buildCollaborators({ playerEntity });
    const expectedAngle = computeAngleFromPlayer(playerEntity.latest.position, playerEntity.latest.yaw, damageOrigin);

    applyFrameEvents(
      [{ type: 'hit', shooterId: 'bot0', targetId: LOCAL_PLAYER_ID, killed: false, damageOrigin }],
      collaborators
    );

    expect(collaborators.damageIndicator.show).toHaveBeenCalledTimes(1);
    expect(collaborators.damageIndicator.show).toHaveBeenCalledWith(expectedAngle);
  });

  it("a 'hit' event from the local player that killed calls hud.flashCrosshair('kill')", () => {
    const collaborators = buildCollaborators();
    const hitEvent = { type: 'hit', shooterId: LOCAL_PLAYER_ID, targetId: 'bot0', killed: true };

    applyFrameEvents([hitEvent], collaborators);

    expect(collaborators.hud.flashCrosshair).toHaveBeenCalledWith('kill');
  });

  it("a 'hit' event from the local player that did not kill calls hud.flashCrosshair('hit')", () => {
    const collaborators = buildCollaborators();
    const hitEvent = { type: 'hit', shooterId: LOCAL_PLAYER_ID, targetId: 'bot0', killed: false };

    applyFrameEvents([hitEvent], collaborators);

    expect(collaborators.hud.flashCrosshair).toHaveBeenCalledWith('hit');
  });

  it("an 'explosion' event calls grenadeFX.spawnExplosion() and gunshots.playExplosion()", () => {
    const collaborators = buildCollaborators();
    const position = { x: 1, y: 0, z: 1 };

    applyFrameEvents([{ type: 'explosion', position }], collaborators);

    expect(collaborators.grenadeFX.spawnExplosion).toHaveBeenCalledWith(position);
    expect(collaborators.gunshots.playExplosion).toHaveBeenCalledWith(position);
  });
});
