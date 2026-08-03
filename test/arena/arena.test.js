import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createArena } from '../../src/arena/arena.js';
import { createMovementSystem, EYE_HEIGHT } from '../../src/sim/movement.js';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';

await RAPIER.init();

// Drops a probe character onto the arena's ground and lets it settle, then
// returns the world-space eye height a real standing character would have
// -- the same height the LOS ray (fsm.js) and the hitscan ray (weapon.js)
// actually use.
function measureStandingEyeHeight(arena) {
  const movementSystem = createMovementSystem(arena.rapierWorld);
  const world = createWorld({ physics: movementSystem });
  world.addEntity('probe', { position: { x: -10, y: 5, z: 0 } }); // clear of the centre cover box
  movementSystem.addCharacter('probe', { x: -10, y: 5, z: 0 });
  movementSystem.commit();
  for (let i = 0; i < 60; i++) {
    world.step(new Map([['probe', createCommand()]]), 1 / 60);
  }
  return world.getEntity('probe').position.y + EYE_HEIGHT;
}

describe('createArena: cover blocks line of sight at standing eye height (regression)', () => {
  it('the centre cover box blocks a ray between two characters standing on opposite sides', () => {
    // Regression: widening CAPSULE_RADIUS once already raised standing eye
    // height just above the centre box's then-fixed literal height,
    // silently turning it into geometry that blocks nothing. Deriving the
    // box height from the capsule/eye-height constants (instead of a
    // literal) means a future capsule tuning pass fails this test instead
    // of silently disabling cover again.
    const arena = createArena();
    const eyeHeight = measureStandingEyeHeight(arena);

    const origin = { x: -5, y: eyeHeight, z: 0 };
    const target = { x: 5, y: eyeHeight, z: 0 };
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const distance = Math.hypot(dx, dz);
    const direction = { x: dx / distance, y: 0, z: dz / distance };

    const hit = arena.rapierWorld.castRay(new RAPIER.Ray(origin, direction), distance, true);
    expect(hit).not.toBeNull();
  });
});
