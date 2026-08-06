// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installDebugHooks } from '../../src/debug/testHooks.js';
import { LOCAL_PLAYER_ID } from '../../src/ui/names.js';

// Minimal fake sim: only world.getEntity is ever read by installDebugHooks'
// hooks, backed by a plain mutable id->entity map so __debugSetScore's
// mutation is directly observable.
function fakeSim(entitiesById) {
  return {
    world: {
      getEntity: (id) => entitiesById[id],
    },
  };
}

function install(overrides = {}) {
  const entitiesById = {
    [LOCAL_PLAYER_ID]: { id: LOCAL_PLAYER_ID, score: 0, position: { x: 0, y: 0, z: 0 } },
    bot0: { id: 'bot0', score: 0, position: { x: 1, y: 0, z: 1 } },
  };
  const bots = [{ id: 'bot0', active: true, mesh: { visible: true, rotation: { y: 0 } } }];
  const debugCounters = { fires: 0, crosshairFlashes: 0, damageIndicatorShows: 0 };
  const sim = fakeSim(entitiesById);

  installDebugHooks({
    sim,
    bots,
    debugCounters,
    camera: { getWorldDirection: () => {} },
    inputSampler: { sample: () => ({}) },
    movementSystem: { teleport: () => {} },
    gameShell: { getState: () => 'PLAYING', debugForceLockAcquired: () => {}, debugForceLockLost: () => {} },
    scene: { children: [] },
    botCount: 4,
    getMatchElapsedSeconds: () => 0,
    getLastRenderState: () => [],
    ...overrides,
  });

  return { entitiesById, bots, debugCounters, sim };
}

describe('installDebugHooks', () => {
  it('__debugState reflects the passed-in sim, bots, and counters', () => {
    const { debugCounters } = install();
    debugCounters.fires = 3;

    const state = window.__debugState();

    expect(state.player.id).toBe(LOCAL_PLAYER_ID);
    expect(state.bots).toEqual([{ id: 'bot0', score: 0, position: { x: 1, y: 0, z: 1 } }]);
    expect(state.counters).toEqual({ fires: 3, crosshairFlashes: 0, damageIndicatorShows: 0 });
  });

  it('__debugSetScore mutates the target entity in place', () => {
    const { entitiesById } = install();

    window.__debugSetScore('bot0', 7);

    expect(entitiesById.bot0.score).toBe(7);
  });

  it("__debugBotRamp reflects an updated matchElapsedSeconds if the getter's value changes after install (live read, not a snapshot)", () => {
    let matchElapsedSeconds = 0;
    install({ getMatchElapsedSeconds: () => matchElapsedSeconds, botCount: 4 });

    // 0s elapsed: getActiveBotCount(0, 4) == 2.
    expect(window.__debugBotRamp().targetCount).toBe(2);

    // Mutated *after* installDebugHooks() already ran -- only a live getter
    // read, not a value captured at install time, can see this.
    matchElapsedSeconds = 25;

    expect(window.__debugBotRamp().matchElapsedSeconds).toBe(25);
    // getActiveBotCount(25, 4) == min(2 + floor(25/20), 4) == 3.
    expect(window.__debugBotRamp().targetCount).toBe(3);
  });
});
