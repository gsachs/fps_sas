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
// test that needs real Rapier geometry but not the full arena layout.
export function buildBotRig({ obstacles = [] } = {}) {
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
  const weaponSystem = createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks: 0 });
  const healthSystem = createHealthSystem({
    rapierWorld,
    spawnPoints: [{ x: 0, y: 1, z: 0 }],
    movementSystem,
  });
  const combat = {
    resolveFire: weaponSystem.resolveFire,
    applyHit: healthSystem.applyHit,
    tickRespawns: healthSystem.tickRespawns,
  };
  const world = createWorld({ physics: movementSystem, combat });
  return { world, movementSystem, rapierWorld };
}

export function addEntity(rig, id, position) {
  rig.world.addEntity(id, { position: { ...position } });
  rig.movementSystem.addCharacter(id, position);
}
