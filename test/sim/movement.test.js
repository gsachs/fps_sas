import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';
import { createMovementSystem, CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, CAPSULE_GROUND_OFFSET } from '../../src/sim/movement.js';

await RAPIER.init();

describe('CAPSULE_GROUND_OFFSET', () => {
  it('pins the derived constant so main.js/arena.js drift is caught directly, not only through their composed values', () => {
    expect(CAPSULE_GROUND_OFFSET).toBeCloseTo(CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);
  });
});

function buildTestRig({ obstacles = [] } = {}) {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
  for (const obstacle of obstacles) {
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(obstacle.hx, obstacle.hy, obstacle.hz).setTranslation(
        obstacle.x,
        obstacle.y,
        obstacle.z
      )
    );
  }

  const movement = createMovementSystem(rapierWorld);
  const world = createWorld({ physics: movement });
  return { world, movement };
}

describe('movement: wall collision (AE3)', () => {
  it('stops at the wall surface instead of passing through', () => {
    const { world, movement } = buildTestRig({
      obstacles: [{ x: 3, y: 1, z: 0, hx: 0.2, hy: 2, hz: 5 }],
    });
    world.addEntity('player', { position: { x: 0, y: 1, z: 0 } });
    movement.addCharacter('player', { x: 0, y: 1, z: 0 });

    // Face +X (yaw = 90deg) and hold forward for a couple of seconds of ticks.
    const command = createCommand({ moveZ: 1, yaw: Math.PI / 2 });
    for (let i = 0; i < 180; i++) {
      world.step(new Map([['player', command]]), 1 / 60);
    }

    const finalX = world.getEntity('player').position.x;
    expect(finalX).toBeLessThan(2.9); // wall face is at x=2.8; never passes through
  });
});

describe('movement: jump only applies while grounded', () => {
  it('does not re-trigger jump velocity mid-air', () => {
    const { world, movement } = buildTestRig();
    world.addEntity('player', { position: { x: 0, y: 1, z: 0 } });
    movement.addCharacter('player', { x: 0, y: 1, z: 0 });

    // Let the character settle onto the ground first.
    for (let i = 0; i < 30; i++) {
      world.step(new Map([['player', createCommand()]]), 1 / 60);
    }
    const groundedY = world.getEntity('player').position.y;

    // Hold jump for several ticks; a re-triggering bug would keep adding
    // upward velocity each tick and launch the character far higher than a
    // single jump impulse would.
    const jumpCommand = createCommand({ buttons: { fire: false, jump: true } });
    let peakY = groundedY;
    for (let i = 0; i < 20; i++) {
      world.step(new Map([['player', jumpCommand]]), 1 / 60);
      peakY = Math.max(peakY, world.getEntity('player').position.y);
    }

    // A single jump impulse (5 m/s) under gravity (9.81 m/s^2) peaks at
    // v^2/2g =~ 1.27m above the grounded height; a re-triggering bug would
    // blow well past that.
    expect(peakY - groundedY).toBeLessThan(2);
  });
});
