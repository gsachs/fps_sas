import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';
import { createMovementSystem } from '../../src/sim/movement.js';
import { createWeaponSystem } from '../../src/sim/weapon.js';
import { createHealthSystem } from '../../src/sim/health.js';
import { createBasicBot } from '../../src/sim/bot/basic.js';
import { pickSpawnPoint } from '../../src/arena/spawns.js';

await RAPIER.init();

function buildBotRig({ cooldownTicks = 0 } = {}) {
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));

  const movementSystem = createMovementSystem(rapierWorld);
  const weaponSystem = createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks });
  const healthSystem = createHealthSystem({
    pickSpawnPoint,
    spawnPoints: [{ x: 0, y: 1, z: 0 }],
    movementSystem,
  });
  const combat = {
    resolveFire: weaponSystem.resolveFire,
    applyHit: healthSystem.applyHit,
    tickRespawns: healthSystem.tickRespawns,
  };
  const world = createWorld({ physics: movementSystem, combat });
  return { world, movementSystem };
}

function addEntity(rig, id, position) {
  rig.world.addEntity(id, { position: { ...position } });
  rig.movementSystem.addCharacter(id, position);
}

describe('createBasicBot: command-shape parity (AE4)', () => {
  it('produces the same Command shape as a player-driven command', () => {
    const bot = createBasicBot();
    const botCommand = bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 });
    const playerCommand = createCommand({ moveZ: 1, yaw: 0.3 });

    expect(Object.keys(botCommand).sort()).toEqual(Object.keys(playerCommand).sort());
    expect(Object.keys(botCommand.buttons).sort()).toEqual(Object.keys(playerCommand.buttons).sort());
  });

  it('resolves through world.step() exactly like any other command source', () => {
    const rig = buildBotRig();
    addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
    rig.movementSystem.commit();

    const bot = createBasicBot();
    const command = bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 });

    expect(() => rig.world.step(new Map([['bot', command]]), 1 / 60)).not.toThrow();
  });
});

describe('createBasicBot: moves toward the player and fires', () => {
  it('closes distance to the player and eventually queues a fire press', () => {
    const rig = buildBotRig();
    addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
    rig.movementSystem.commit();

    const bot = createBasicBot({ random: () => 0.5 }); // midpoint -> zero jitter
    const player = { x: 0, y: 1, z: 10 };
    let firedAtLeastOnce = false;

    for (let i = 0; i < 60; i++) {
      const botPosition = rig.world.getEntity('bot').position;
      const command = bot.sample(botPosition, player);
      if (command.buttons.fire) firedAtLeastOnce = true;
      rig.world.step(new Map([['bot', command]]), 1 / 60);
    }

    const finalDistance = Math.hypot(
      player.x - rig.world.getEntity('bot').position.x,
      player.z - rig.world.getEntity('bot').position.z
    );
    expect(finalDistance).toBeLessThan(10);
    expect(firedAtLeastOnce).toBe(true);
  });
});

describe('createBasicBot: aim spread reduces accuracy', () => {
  it('hits a direct-line target with zero spread and misses the same shot with a large spread', () => {
    function fireOnce(aimSpread) {
      const rig = buildBotRig();
      addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
      addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
      rig.movementSystem.commit();

      const bot = createBasicBot({ aimSpread, random: () => 1 }); // worst-case jitter roll
      const aimed = bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 });
      rig.world.step(
        new Map([
          ['bot', createCommand({ ...aimed, buttons: { fire: true, jump: false } })],
          ['target', createCommand()],
        ]),
        1 / 60
      );
      return rig.world.getEntity('target').health;
    }

    expect(fireOnce(0)).toBeLessThan(100); // no spread: direct line, hits
    expect(fireOnce(0.5)).toBe(100); // wide spread: deviates well past the target
  });
});
