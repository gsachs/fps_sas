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
function measureStandingEyeHeight(arena, dropPosition) {
  const movementSystem = createMovementSystem(arena.rapierWorld);
  const world = createWorld({ physics: movementSystem });
  world.addEntity('probe', { position: dropPosition });
  movementSystem.addCharacter('probe', dropPosition);
  movementSystem.commit();
  for (let i = 0; i < 60; i++) {
    world.step(new Map([['probe', createCommand()]]), 1 / 60);
  }
  return world.getEntity('probe').position.y + EYE_HEIGHT;
}

describe('createArena: asymmetric-districts line of sight (R2)', () => {
  it('blocks a ray between two districts on opposite sides of the map', () => {
    const arena = createArena();
    // Real spawn points (already verified inside their district and clear
    // of all geometry, including pillars/cover, by test/arena/layout.test.js)
    // rather than hand-picked coordinates: a ray cast from inside a
    // collider reports an immediate hit against that collider regardless
    // of the real wall/corridor topology between the districts, which would
    // make this test pass even if that topology broke -- Yard and Bazaar
    // sit on opposite sides of the landmark with multiple walls and a bend
    // between them, verified below to actually be occluded, not a lucky
    // doorway-gap alignment.
    const origin3d = arena.spawnPoints.find((p) => p.x === -50 && p.z === 5);
    const target3d = arena.spawnPoints.find((p) => p.x === 40 && p.z === 47);
    expect(origin3d).toBeDefined();
    expect(target3d).toBeDefined();
    const eyeHeight = measureStandingEyeHeight(arena, { ...origin3d, y: 5 });

    const origin = { x: origin3d.x, y: eyeHeight, z: origin3d.z };
    const target = { x: target3d.x, y: eyeHeight, z: target3d.z };
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const distance = Math.hypot(dx, dz);
    const direction = { x: dx / distance, y: 0, z: dz / distance };

    const hit = arena.rapierWorld.castRay(new RAPIER.Ray(origin, direction), distance, true);
    expect(hit).not.toBeNull();
  });
});
