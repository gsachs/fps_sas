import { describe, expect, it } from 'vitest';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';

function buildWorldWithPlayer() {
  const world = createWorld();
  world.addEntity('player');
  return world;
}

describe('world.step determinism', () => {
  it('produces identical resulting state given identical command sequences', () => {
    const commandSequence = [
      createCommand({ moveX: 1, yaw: 0.1 }),
      createCommand({ moveX: 1, moveZ: 0.5, yaw: 0.2 }),
      createCommand({ moveZ: -1, yaw: 0.3 }),
    ];

    function run() {
      const world = buildWorldWithPlayer();
      for (const command of commandSequence) {
        world.step(new Map([['player', command]]), 1 / 60);
      }
      return world.getEntity('player');
    }

    const a = run();
    const b = run();
    expect(a.position).toEqual(b.position);
    expect(a.yaw).toBe(b.yaw);
  });
});

describe('world.getRenderState interpolation', () => {
  it('falls between the previous and current transform at alpha=0.5', () => {
    const world = buildWorldWithPlayer();
    world.step(new Map([['player', createCommand({ moveX: 1 })]]), 1 / 60);
    const beforeX = world.getEntity('player').position.x;

    world.step(new Map([['player', createCommand({ moveX: 1 })]]), 1 / 60);
    const afterX = world.getEntity('player').position.x;

    const [state] = world.getRenderState(0.5);
    expect(state.position.x).toBeCloseTo((beforeX + afterX) / 2, 5);
    expect(state.position.x).toBeGreaterThan(beforeX);
    expect(state.position.x).toBeLessThan(afterX);
  });

  it('exposes latest (un-interpolated) state alongside the interpolated transform', () => {
    const world = buildWorldWithPlayer();
    world.step(new Map([['player', createCommand({ moveX: 1 })]]), 1 / 60);
    world.step(new Map([['player', createCommand({ moveX: 1 })]]), 1 / 60);

    const [state] = world.getRenderState(0.25);
    const entity = world.getEntity('player');
    expect(state.latest.position).toEqual(entity.position);
  });
});

describe('world.step dead-entity guard', () => {
  it('ignores commands for a dead entity', () => {
    const world = buildWorldWithPlayer();
    const entity = world.getEntity('player');
    entity.dead = true;
    const before = { ...entity.position };

    world.step(new Map([['player', createCommand({ moveX: 1, moveZ: 1 })]]), 1 / 60);

    expect(entity.position).toEqual(before);
  });
});

describe('world entity defaults: armory fields (U1 foundation)', () => {
  it('creates entities holding the infinite machine gun, with no grenades', () => {
    const world = createWorld();
    const entity = world.addEntity('player');

    expect(entity.heldWeapon).toBe('machinegun');
    expect(entity.grenadeCount).toBe(0);
  });

  it('passes heldWeapon and grenadeCount through getRenderState uninterpolated', () => {
    const world = createWorld();
    world.addEntity('player');
    const entity = world.getEntity('player');
    entity.grenadeCount = 2;

    const [state] = world.getRenderState(0.5);

    expect(state.heldWeapon).toBe('machinegun');
    expect(state.grenadeCount).toBe(2);
  });
});
