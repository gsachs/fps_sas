import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';
import { createMovementSystem, CAPSULE_RADIUS } from '../../src/sim/movement.js';
import { createWeaponSystem } from '../../src/sim/weapon.js';
import { createHealthSystem } from '../../src/sim/health.js';
import { createSimulation } from '../../src/sim/index.js';
import { createInputSampler } from '../../src/input/sampler.js';

await RAPIER.init();

const FIRE = createCommand({ yaw: 0, pitch: 0, buttons: { fire: true, jump: false } });
const HOLD = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, jump: false } });

function buildCombatRig({ obstacles = [], spawnPoints = [{ x: 0, y: 1, z: 0 }], cooldownTicks = 6 } = {}) {
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
  const weaponSystem = createWeaponSystem({ rapierWorld, movementSystem, cooldownTicks });
  const healthSystem = createHealthSystem({ rapierWorld, spawnPoints, movementSystem });
  const combat = {
    resolveFire: weaponSystem.resolveFire,
    applyHit: healthSystem.applyHit,
    tickRespawns: healthSystem.tickRespawns,
  };
  const world = createWorld({ physics: movementSystem, combat });
  return { world, movementSystem, weaponSystem, healthSystem };
}

// Rapier's broad-phase only indexes newly-created colliders on the next
// world.step() -- a hitscan castRay against a collider created this same
// tick (before any step ran) can miss even though the collider exists at
// the right position. Priming with one step() (safe here: every body is
// kinematic, so it has no side effect before any translation is queued)
// mirrors what main.js does once at real startup, before the game loop
// starts accepting commands.
function primeBroadPhase(rig) {
  rig.movementSystem.commit();
}

function addCombatant(rig, id, position) {
  rig.world.addEntity(id, { position: { ...position } });
  rig.movementSystem.addCharacter(id, position);
}

describe('combat: kill, score, and respawn (AE1)', () => {
  it('kills the target after enough hits, credits the shooter once, and respawns the target with full health', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 20 }];
    const rig = buildCombatRig({ spawnPoints });
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    for (let i = 0; i < 60 && !rig.world.getEntity('target').dead; i++) {
      rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
    }

    expect(rig.world.getEntity('target').dead).toBe(true);
    expect(rig.world.getEntity('target').health).toBe(0);
    expect(rig.world.getEntity('shooter').score).toBe(1);

    for (let i = 0; i < 181; i++) {
      rig.world.step(new Map([['shooter', HOLD], ['target', HOLD]]), 1 / 60);
    }

    const target = rig.world.getEntity('target');
    expect(target.dead).toBe(false);
    expect(target.health).toBe(100);
  });
});

describe('combat: respawn continues arena state (AE2)', () => {
  it('restores the respawned entity without resetting unrelated entities', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 20 }];
    const rig = buildCombatRig({ spawnPoints });
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'target', { x: 0, y: 1, z: 5 });
    addCombatant(rig, 'bystander', { x: 15, y: 1, z: 15 });
    rig.world.getEntity('bystander').score = 3;
    primeBroadPhase(rig);

    for (let i = 0; i < 60 && !rig.world.getEntity('target').dead; i++) {
      rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
    }
    for (let i = 0; i < 181; i++) {
      rig.world.step(new Map([['shooter', HOLD], ['target', HOLD]]), 1 / 60);
    }

    expect(rig.world.getEntity('target').dead).toBe(false);
    expect(rig.world.getEntity('target').health).toBe(100);
    // The unrelated bystander's state must be untouched by the respawn.
    expect(rig.world.getEntity('bystander').score).toBe(3);
    expect(rig.world.getEntity('bystander').position).toEqual({ x: 15, y: 1, z: 15 });
    expect(rig.world.getEntity('shooter').score).toBe(1);
  });
});

describe('combat: miss', () => {
  it('does not change health when the shot does not hit anything', () => {
    const rig = buildCombatRig();
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'target', { x: 50, y: 1, z: 50 }); // well outside the ray's path
    primeBroadPhase(rig);

    rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    expect(rig.world.getEntity('target').health).toBe(100);
  });
});

describe('combat: step() reports fire and hit events (U7 feedback source)', () => {
  it('reports a fire event even on a miss, with no accompanying hit event', () => {
    const rig = buildCombatRig();
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'target', { x: 50, y: 1, z: 50 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    const fireEvent = events.find((e) => e.type === 'fire');
    expect(fireEvent).toMatchObject({ type: 'fire', shooterId: 'shooter' });
    expect(fireEvent.origin).toBeTruthy();
    expect(fireEvent.endPoint).toBeTruthy();
    expect(events.some((e) => e.type === 'hit')).toBe(false);
  });

  it('reports both a fire event and a hit event on a landed shot', () => {
    const rig = buildCombatRig();
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    const fireEvent = events.find((e) => e.type === 'fire');
    expect(fireEvent).toMatchObject({ type: 'fire', shooterId: 'shooter' });
    // Regression coverage: a landed shot's endPoint previously came out NaN
    // (read the ray hit's nonexistent `.toi` instead of `.timeOfImpact`),
    // which only surfaces on an actual hit, not a miss.
    expect(Number.isFinite(fireEvent.endPoint.x)).toBe(true);
    expect(Number.isFinite(fireEvent.endPoint.y)).toBe(true);
    expect(fireEvent.endPoint.z).toBeGreaterThan(0);
    expect(fireEvent.endPoint.z).toBeLessThan(6); // at or just past the target, not a mid-air NaN/miss-range value
    const hitEvent = events.find((e) => e.type === 'hit');
    expect(hitEvent).toMatchObject({ shooterId: 'shooter', targetId: 'target', damage: 20, killed: false });
  });

  it('reports no events when nobody fires', () => {
    const rig = buildCombatRig();
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', HOLD]]), 1 / 60);

    expect(events).toEqual([]);
  });
});

describe('combat: cover blocks hits', () => {
  it('does not hit an entity fully occluded by cover geometry', () => {
    const rig = buildCombatRig({
      obstacles: [{ x: 0, y: 1, z: 5, hx: 2, hy: 2, hz: 0.5 }],
    });
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'target', { x: 0, y: 1, z: 10 });
    primeBroadPhase(rig);

    for (let i = 0; i < 10; i++) {
      rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
    }

    expect(rig.world.getEntity('target').health).toBe(100);
  });
});

describe('combat: hitbox width matches the capsule radius (regression)', () => {
  it('hits a target offset inside the current capsule radius but outside the pre-widening one', () => {
    // Regression for commit db9d9b7: CAPSULE_RADIUS was widened 0.3 -> 0.4
    // after a user reported hits at a character's visible edges not
    // landing. No test exercised hitbox width at all -- this offset (0.35)
    // sits inside the current 0.4 radius but outside the old 0.3 one, so a
    // future narrowing of CAPSULE_RADIUS fails this test instead of
    // silently reintroducing the "hits at the edges miss" bug.
    const edgeOffset = (CAPSULE_RADIUS + 0.3) / 2; // between the old and current radius
    const rig = buildCombatRig();
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'target', { x: edgeOffset, y: 1, z: 5 }); // shooter fires straight down x=0
    primeBroadPhase(rig);

    rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    expect(rig.world.getEntity('target').health).toBeLessThan(100);
  });
});

describe('combat: self-hit exclusion', () => {
  it('excludes the shooter from its own hitscan ray', () => {
    const rig = buildCombatRig();
    addCombatant(rig, 'shooter', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), FIRE);

    expect(result.hitEntityId).not.toBe('shooter');
  });
});

describe('combat: framerate-independent fire rate', () => {
  it('resolves exactly one shot per fire press even when a frame runs multiple sim ticks', () => {
    const rig = buildCombatRig();
    rig.movementSystem.addCharacter('shooter', { x: 0, y: 1, z: 0 });
    rig.movementSystem.addCharacter('target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    const sampler = createInputSampler();
    const combatSim = createSimulation({
      physics: rig.movementSystem,
      combat: {
        resolveFire: rig.weaponSystem.resolveFire,
        applyHit: rig.healthSystem.applyHit,
        tickRespawns: rig.healthSystem.tickRespawns,
      },
      gatherCommands: () => {
        const command = sampler.sample();
        return new Map([
          ['shooter', createCommand({ ...command, yaw: 0, pitch: 0 })],
          ['target', HOLD],
        ]);
      },
    });
    combatSim.world.addEntity('shooter', { position: { x: 0, y: 1, z: 0 } });
    combatSim.world.addEntity('target', { position: { x: 0, y: 1, z: 5 } });

    sampler.onFirePressed(); // exactly one discrete press
    // A long frame delta forces the fixed-step loop to run several ticks
    // in this single tick() call -- the bug scenario the review flagged.
    combatSim.tick(5 / 60);

    expect(combatSim.world.getEntity('target').health).toBe(80); // exactly one 20-damage hit
  });
});

describe('combat: simultaneous lethal hits credit exactly one killer', () => {
  it('does not double-count a kill when two shooters land lethal hits in the same tick', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }];
    const rig = buildCombatRig({ spawnPoints, cooldownTicks: 0 });
    addCombatant(rig, 'shooterA', { x: 0, y: 1, z: 0 });
    addCombatant(rig, 'shooterB', { x: 0, y: 1, z: 10 });
    addCombatant(rig, 'target', { x: 0, y: 1, z: 5 });
    rig.world.getEntity('target').health = 15; // one hit (20 dmg) is already lethal
    primeBroadPhase(rig);

    const fireAtTarget = createCommand({ yaw: 0, pitch: 0, buttons: { fire: true, jump: false } });
    const fireAtTargetFromB = createCommand({ yaw: Math.PI, pitch: 0, buttons: { fire: true, jump: false } });

    rig.world.step(
      new Map([
        ['shooterA', fireAtTarget],
        ['shooterB', fireAtTargetFromB],
        ['target', HOLD],
      ]),
      1 / 60
    );

    const totalScore = rig.world.getEntity('shooterA').score + rig.world.getEntity('shooterB').score;
    expect(totalScore).toBe(1);
    expect(rig.world.getEntity('target').dead).toBe(true);
  });
});
