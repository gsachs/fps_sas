import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';
import { createMovementSystem } from '../../src/sim/movement.js';
import { createWeaponSystem } from '../../src/sim/weapon.js';
import { createHealthSystem } from '../../src/sim/health.js';
import { pickSpawnPoint } from '../../src/arena/spawns.js';
import {
  transitionBotState,
  createInitialBotState,
  createBotAI,
  ATTACK_RANGE,
  AWARENESS_RANGE,
  RETREAT_HEALTH_THRESHOLD,
  RETREAT_DURATION_TICKS,
} from '../../src/sim/bot/fsm.js';

await RAPIER.init();

function buildBotRig({ obstacles = [] } = {}) {
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
  return { world, movementSystem, rapierWorld };
}

function addEntity(rig, id, position) {
  rig.world.addEntity(id, { position: { ...position } });
  rig.movementSystem.addCharacter(id, position);
}

describe('transitionBotState (pure)', () => {
  it('goes idle -> chase once the player is within awareness range', () => {
    const state = createInitialBotState();
    const next = transitionBotState(
      state,
      { distanceToPlayer: AWARENESS_RANGE - 1, hasLineOfSight: false, health: 100 },
      1
    );
    expect(next.phase).toBe('chase');
  });

  it('stays idle when the player is beyond awareness range and out of sight', () => {
    const state = createInitialBotState();
    const next = transitionBotState(
      state,
      { distanceToPlayer: AWARENESS_RANGE + 5, hasLineOfSight: false, health: 100 },
      1
    );
    expect(next.phase).toBe('idle');
  });

  it('transitions Chase -> Attack once the player enters line of sight within attack range', () => {
    const chasing = { phase: 'chase', retreatArmed: true, retreatEndTick: 0 };
    const next = transitionBotState(
      chasing,
      { distanceToPlayer: ATTACK_RANGE - 1, hasLineOfSight: true, health: 100 },
      10
    );
    expect(next.phase).toBe('attack');
  });

  it('drops Attack -> Chase (re-acquire) once line of sight breaks', () => {
    const attacking = { phase: 'attack', retreatArmed: true, retreatEndTick: 0 };
    const next = transitionBotState(
      attacking,
      { distanceToPlayer: ATTACK_RANGE - 1, hasLineOfSight: false, health: 100 },
      10
    );
    expect(next.phase).toBe('chase');
  });

  it('drops Attack -> Idle (patrol) once both out of range and out of sight', () => {
    const attacking = { phase: 'attack', retreatArmed: true, retreatEndTick: 0 };
    const next = transitionBotState(
      attacking,
      { distanceToPlayer: AWARENESS_RANGE + 5, hasLineOfSight: false, health: 100 },
      10
    );
    expect(next.phase).toBe('idle');
  });

  describe('retreat hysteresis (no health regen in this game)', () => {
    it('enters retreat on a fresh drop below the health threshold', () => {
      const attacking = { phase: 'attack', retreatArmed: true, retreatEndTick: 0 };
      const next = transitionBotState(
        attacking,
        { distanceToPlayer: 5, hasLineOfSight: true, health: RETREAT_HEALTH_THRESHOLD - 1 },
        100
      );
      expect(next.phase).toBe('retreat');
      expect(next.retreatEndTick).toBe(100 + RETREAT_DURATION_TICKS);
    });

    it('does NOT re-enter retreat the instant the timer expires while health is still low', () => {
      // This is the exact bug a level-triggered (non-latched) guard produces:
      // health never recovers without a respawn, so if retreat re-armed
      // itself as soon as the timer ran out, the bot would retreat forever
      // in one-tick flickers back to "attack".
      let state = { phase: 'retreat', retreatArmed: false, retreatEndTick: 50 };
      state = transitionBotState(state, { distanceToPlayer: 5, hasLineOfSight: true, health: 10 }, 51);
      expect(state.phase).not.toBe('retreat');
      // One more tick at the same still-low health must not flip it back.
      const again = transitionBotState(state, { distanceToPlayer: 5, hasLineOfSight: true, health: 10 }, 52);
      expect(again.phase).not.toBe('retreat');
    });

    it('re-arms retreat once health recovers (post-respawn), allowing a fresh trigger', () => {
      let state = { phase: 'chase', retreatArmed: false, retreatEndTick: 0 };
      state = transitionBotState(state, { distanceToPlayer: 5, hasLineOfSight: true, health: 100 }, 200); // respawn heals
      expect(state.retreatArmed).toBe(true);
      state = transitionBotState(
        state,
        { distanceToPlayer: 5, hasLineOfSight: true, health: RETREAT_HEALTH_THRESHOLD - 1 },
        201
      );
      expect(state.phase).toBe('retreat');
    });
  });
});

describe('createBotAI: command-shape parity (AE4)', () => {
  it('produces the same Command shape as a player-driven command', () => {
    const rig = buildBotRig();
    addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
    rig.movementSystem.commit();
    const bot = createBotAI({ rapierWorld: rig.rapierWorld, movementSystem: rig.movementSystem, botId: 'bot' });
    const botCommand = bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 }, 100);
    const playerCommand = createCommand({ moveZ: 1, yaw: 0.3 });

    expect(Object.keys(botCommand).sort()).toEqual(Object.keys(playerCommand).sort());
    expect(Object.keys(botCommand.buttons).sort()).toEqual(Object.keys(playerCommand.buttons).sort());
  });
});

describe('createBotAI: moves toward the player and fires once in range', () => {
  it('closes distance and eventually queues a fire press', () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
    const movementSystem = createMovementSystem(rapierWorld);
    const weaponSystem = createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks: 0 });
    const healthSystem = createHealthSystem({ pickSpawnPoint, spawnPoints: [{ x: 0, y: 1, z: 0 }], movementSystem });
    const combat = { resolveFire: weaponSystem.resolveFire, applyHit: healthSystem.applyHit, tickRespawns: healthSystem.tickRespawns };
    const world = createWorld({ physics: movementSystem, combat });
    world.addEntity('bot', { position: { x: 0, y: 1, z: 0 } });
    movementSystem.addCharacter('bot', { x: 0, y: 1, z: 0 });
    movementSystem.commit();

    const bot = createBotAI({ rapierWorld, movementSystem, botId: 'bot', random: () => 0.5 });
    const player = { x: 0, y: 1, z: ATTACK_RANGE - 2 }; // start already in range+LOS
    let firedAtLeastOnce = false;

    for (let i = 0; i < 120; i++) {
      const botPosition = world.getEntity('bot').position;
      const command = bot.sample(botPosition, player, 100);
      if (command.buttons.fire) firedAtLeastOnce = true;
      world.step(new Map([['bot', command]]), 1 / 60);
    }

    const finalDistance = Math.hypot(
      player.x - world.getEntity('bot').position.x,
      player.z - world.getEntity('bot').position.z
    );
    expect(finalDistance).toBeLessThan(ATTACK_RANGE);
    expect(firedAtLeastOnce).toBe(true);
    expect(bot.getPhase()).toBe('attack');
  });
});

describe('createBotAI: line of sight gates firing', () => {
  it('does not fire when cover fully blocks line of sight to the player', () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, 0.5).setTranslation(0, 1, 5));
    const movementSystem = createMovementSystem(rapierWorld);
    movementSystem.addCharacter('bot', { x: 0, y: 1, z: 0 });
    movementSystem.commit();

    const bot = createBotAI({ rapierWorld, movementSystem, botId: 'bot', random: () => 0.5 });
    const player = { x: 0, y: 1, z: 10 }; // straight line, but cover sits between bot and player

    let firedAtLeastOnce = false;
    for (let i = 0; i < 60; i++) {
      const command = bot.sample({ x: 0, y: 1, z: 0 }, player, 100);
      if (command.buttons.fire) firedAtLeastOnce = true;
    }

    expect(firedAtLeastOnce).toBe(false);
    expect(bot.getPhase()).not.toBe('attack');
  });
});

describe('createBotAI: difficulty is tunable', () => {
  it('high aim spread measurably widens yaw variance versus zero spread', () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
    const movementSystem = createMovementSystem(rapierWorld);
    movementSystem.addCharacter('precise', { x: 0, y: 1, z: 0 });
    movementSystem.addCharacter('sloppy', { x: 0, y: 1, z: 0 });
    movementSystem.commit();

    const player = { x: 0, y: 1, z: 5 };
    const precise = createBotAI({
      rapierWorld,
      movementSystem,
      botId: 'precise',
      difficulty: { aimSpread: 0, reactionDelayTicks: 0 },
      random: () => 1, // worst-case jitter roll
    });
    const sloppy = createBotAI({
      rapierWorld,
      movementSystem,
      botId: 'sloppy',
      difficulty: { aimSpread: 0.8, reactionDelayTicks: 0 },
      random: () => 1,
    });

    const preciseYaw = precise.sample({ x: 0, y: 1, z: 0 }, player, 100).yaw;
    const sloppyYaw = sloppy.sample({ x: 0, y: 1, z: 0 }, player, 100).yaw;

    expect(Math.abs(sloppyYaw - preciseYaw)).toBeGreaterThan(0.3);
  });

  it('higher reaction delay postpones the first shot after entering attack range', () => {
    // reactionDelayTicks gates the *first* shot of a fresh attack episode
    // independently of the fire-interval cadence (a bot that already spent
    // time chasing enters attack with its fire timer partly elapsed) -- so
    // to see reaction delay's effect distinctly, use a value clearly past
    // FIRE_INTERVAL_TICKS (45); a smaller value would be masked by it.
    function ticksUntilFirstShot(reactionDelayTicks) {
      const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0));
      const movementSystem = createMovementSystem(rapierWorld);
      movementSystem.addCharacter('bot', { x: 0, y: 1, z: 0 });
      movementSystem.commit();

      const bot = createBotAI({
        rapierWorld,
        movementSystem,
        botId: 'bot',
        difficulty: { aimSpread: 0, reactionDelayTicks },
        random: () => 0.5,
      });
      const player = { x: 0, y: 1, z: ATTACK_RANGE - 2 }; // already in range+LOS from tick 1

      for (let tick = 1; tick <= 150; tick++) {
        const command = bot.sample({ x: 0, y: 1, z: 0 }, player, 100);
        if (command.buttons.fire) return tick;
      }
      return Infinity;
    }

    expect(ticksUntilFirstShot(90)).toBeGreaterThan(ticksUntilFirstShot(0));
  });
});
