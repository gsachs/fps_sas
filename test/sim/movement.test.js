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

describe('movement: strafe direction matches the rendered camera (regression)', () => {
  // The camera's world-forward direction is entityMesh.js's
  // computeCameraYaw(simYaw) = simYaw + PI fed into a standard Three.js
  // Y-axis rotation of the camera's local forward (0,0,-1): working that
  // through algebraically gives (sin(simYaw), cos(simYaw)) -- exactly this
  // module's own `forward` vector, confirmed live via the camera and
  // matching what the hitscan/aim already relies on. The camera's *visual
  // right* (what a player watching the screen would call "right") is
  // forward x up in this Y-up, right-handed scene: (-cos(simYaw), sin(simYaw)).
  // Verified directly against the real rendered camera in a headless
  // browser before writing this (window.__debugCameraForward()) -- a
  // strafe-direction bug like this is exactly the kind that reads fine on
  // a code review pass (the variable is named `right`) and only shows up
  // against the actual screen, which is how it shipped and was found live.
  function visualRight(yaw) {
    return { x: -Math.cos(yaw), z: Math.sin(yaw) };
  }

  it('pressing the strafe-right key (D) moves the player toward the camera-visual-right direction, not left', () => {
    const { world, movement } = buildTestRig();
    world.addEntity('player', { position: { x: 0, y: 1, z: 0 } });
    movement.addCharacter('player', { x: 0, y: 1, z: 0 });

    const yaw = 0;
    const command = createCommand({ moveX: 1, moveZ: 0, yaw }); // D held, facing sim yaw 0
    for (let i = 0; i < 30; i++) {
      world.step(new Map([['player', command]]), 1 / 60);
    }

    const position = world.getEntity('player').position;
    const moved = { x: position.x, z: position.z }; // started at the origin
    const distance = Math.hypot(moved.x, moved.z);
    expect(distance).toBeGreaterThan(0.1); // sanity: it actually moved
    const normalizedMoved = { x: moved.x / distance, z: moved.z / distance };

    const expectedRight = visualRight(yaw);
    const dot = normalizedMoved.x * expectedRight.x + normalizedMoved.z * expectedRight.z;
    expect(dot).toBeGreaterThan(0.9); // moved toward camera-visual-right, not away from it
  });
});

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
