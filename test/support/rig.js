// Shared Rapier test-rig construction (tidy-first extraction, U3): several
// bot-AI test files each rebuilt the same floor-plus-movement-system
// boilerplate by hand, sometimes only partially (skipping the combat stack,
// or skipping world entirely) -- this is the one place that shape is built.
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from '../../src/sim/world.js';
import { createMovementSystem } from '../../src/sim/movement.js';
import { createWeaponSystem } from '../../src/sim/weapon.js';
import { createHealthSystem } from '../../src/sim/health.js';

// A flat 60x60 floor plus optional box obstacles -- enough for any bot-AI
// or combat test that needs real Rapier geometry but not the full arena
// layout. `spawnPoints` and `cooldownTicks` default to the single-spawn,
// zero-cooldown shape bot-AI tests have always gotten, so existing callers
// that omit them see no behavior change; combat tests that need the
// machine gun's real cooldown or multiple spawns pass them explicitly.
export function buildBotRig({
  obstacles = [],
  spawnPoints = [{ x: 0, y: 1, z: 0 }],
  cooldownTicks = 0,
  random = Math.random,
} = {}) {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
  for (const obstacle of obstacles) {
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(obstacle.hx, obstacle.hy, obstacle.hz).setTranslation(
        obstacle.x,
        obstacle.y,
        obstacle.z
      )
    );
  }

  const movementSystem = createMovementSystem(rapierWorld);
  const weaponSystem = createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks, random });
  const healthSystem = createHealthSystem({ rapierWorld, spawnPoints, movementSystem });
  const combat = {
    resolveFire: weaponSystem.resolveFire,
    applyHit: healthSystem.applyHit,
    tickRespawns: healthSystem.tickRespawns,
    tickAirdrops: healthSystem.tickAirdrops,
  };
  const world = createWorld({ physics: movementSystem, combat });
  return { world, movementSystem, weaponSystem, healthSystem, rapierWorld };
}

export function addEntity(rig, id, position) {
  rig.world.addEntity(id, { position: { ...position } });
  rig.movementSystem.addCharacter(id, position);
}

// Rapier's broad-phase only indexes newly-created colliders on the next
// world.step() -- a hitscan castRay against a collider created this same
// tick (before any step ran) can miss even though the collider exists at
// the right position. Priming with one step() (safe here: every body is
// kinematic, so it has no side effect before any translation is queued)
// mirrors what main.js does once at real startup, before the game loop
// starts accepting commands.
export function primeBroadPhase(rig) {
  rig.movementSystem.commit();
}
