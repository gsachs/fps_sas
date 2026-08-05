import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCommand } from '../../src/sim/command.js';
import { CAPSULE_RADIUS } from '../../src/sim/movement.js';
import { createSimulation } from '../../src/sim/index.js';
import { createInputSampler } from '../../src/input/sampler.js';
import { computeAngleFromPlayer } from '../../src/render/feedback.js';
import { MACHINEGUN_SPREAD_RADIANS } from '../../src/sim/weapon.js';
import { buildBotRig, addEntity, primeBroadPhase } from '../support/rig.js';

await RAPIER.init();

const FIRE = createCommand({ yaw: 0, pitch: 0, buttons: { fire: true, fireHeld: false, jump: false, throwGrenade: false } });
const HOLD = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false } });
// The machine gun gates on the held-fire level, not the edge latch (KTD2) --
// tests exercising it directly need this instead of FIRE.
const HELD_FIRE = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: true, jump: false, throwGrenade: false } });

// This file's rig used to be its own hand-rolled copy of test/support/rig.js
// (same Rapier floor, same weapon/health wiring) -- folded into the shared
// buildBotRig/addEntity/primeBroadPhase so there is one rig-construction
// path for both bot-AI and combat tests. Every call below that omitted
// cooldownTicks relied on the pistol's real 6-tick cooldown (this file's old
// default), so it's passed explicitly here to keep that behavior identical
// under the shared builder's own (bot-AI-oriented) default of 0.

describe('combat: kill, score, and respawn (AE1)', () => {
  it('kills the target after enough hits, credits the shooter once, and respawns the target with full health', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 20 }];
    const rig = buildBotRig({ spawnPoints, cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
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
    const rig = buildBotRig({ spawnPoints, cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    addEntity(rig, 'bystander', { x: 15, y: 1, z: 15 });
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
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 50, y: 1, z: 50 }); // well outside the ray's path
    primeBroadPhase(rig);

    rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    expect(rig.world.getEntity('target').health).toBe(100);
  });
});

describe('combat: step() reports fire and hit events (U7 feedback source)', () => {
  it('reports a fire event even on a miss, with no accompanying hit event', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 50, y: 1, z: 50 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    const fireEvent = events.find((e) => e.type === 'fire');
    expect(fireEvent).toMatchObject({ type: 'fire', shooterId: 'shooter' });
    expect(fireEvent.origin).toBeTruthy();
    expect(fireEvent.endPoint).toBeTruthy();
    expect(events.some((e) => e.type === 'hit')).toBe(false);
  });

  it('reports both a fire event and a hit event on a landed shot', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
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
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', HOLD]]), 1 / 60);

    expect(events).toEqual([]);
  });
});

describe('combat: cover blocks hits', () => {
  it('does not hit an entity fully occluded by cover geometry', () => {
    const rig = buildBotRig({
      obstacles: [{ x: 0, y: 1, z: 5, hx: 2, hy: 2, hz: 0.5 }],
      cooldownTicks: 6,
    });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 10 });
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
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: edgeOffset, y: 1, z: 5 }); // shooter fires straight down x=0
    primeBroadPhase(rig);

    rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    expect(rig.world.getEntity('target').health).toBeLessThan(100);
  });
});

describe('combat: self-hit exclusion', () => {
  it('excludes the shooter from its own hitscan ray', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), FIRE);

    expect(result.hitEntityId).not.toBe('shooter');
  });
});

describe('combat: framerate-independent fire rate', () => {
  it('resolves exactly one shot per fire press even when a frame runs multiple sim ticks', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
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
    const rig = buildBotRig({ spawnPoints, cooldownTicks: 0 });
    addEntity(rig, 'shooterA', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'shooterB', { x: 0, y: 1, z: 10 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
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

describe('combat: pistol held-fire regression (U2 -- R2, click-per-shot unchanged)', () => {
  it('fires exactly once while the mouse stays held down, never once per tick', () => {
    // The single most important regression this unit can introduce: the MG
    // needs a held-fire *level*, but the pistol must keep firing strictly on
    // the edge latch. If held-fire ever leaked into the pistol's gate, this
    // test would see many hits (one per cooldown window) instead of exactly
    // one -- see this unit's report for the red-then-green verification that
    // this test actually catches that failure mode.
    const rig = buildBotRig({ cooldownTicks: 6 });
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

    sampler.onFirePressed(); // mousedown: queues the edge shot and, once fireHeld exists, starts the level
    // The mouse never comes up (no onFireReleased call) for many ticks and
    // several cooldown windows -- exactly the shape a real held click makes.
    for (let i = 0; i < 30; i++) combatSim.tick(1 / 60);

    expect(combatSim.world.getEntity('target').health).toBe(80); // exactly one 20-damage hit, not several
  });
});

describe('combat: machine gun sprays while held, drains ammo, and auto-reverts (AE1, R1)', () => {
  it('fires every cooldown window while fireHeld stays true, decrements ammo, and reverts to the pistol with no new input once dry', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    const shooter = rig.world.getEntity('shooter');
    shooter.heldWeapon = 'machinegun';
    shooter.ammo = 3; // small magazine so the revert is reachable within a short loop
    primeBroadPhase(rig);

    let shotsFired = 0;
    for (let tick = 0; tick < 20; tick++) {
      const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), HELD_FIRE);
      if (result.fired) shotsFired += 1;
    }

    expect(shotsFired).toBe(3); // exactly the magazine size, not more
    expect(rig.world.getEntity('shooter').heldWeapon).toBe('pistol'); // R1's auto-revert
    expect(rig.world.getEntity('shooter').ammo).toBeNull(); // reads as infinite again, like any pistol

    // The mouse is still held (fireHeld never goes false), but the entity is
    // the pistol now -- KTD2's whole point is that a stale level alone,
    // with the edge queue empty, must not fire it.
    const afterRevert = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), HELD_FIRE);
    expect(afterRevert.fired).toBe(false);
  });
});

describe('combat: machine-gun spread (R1, KTD2)', () => {
  it('consecutive shots from a fixed pose vary in direction but stay within the configured spread bound', () => {
    const rig = buildBotRig();
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    const shooter = rig.world.getEntity('shooter');
    shooter.heldWeapon = 'machinegun';
    shooter.ammo = 1000; // plenty -- this test is about direction, not the revert
    primeBroadPhase(rig);

    const yawAngles = [];
    for (let tick = 0; tick < 100 && yawAngles.length < 20; tick++) {
      const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), HELD_FIRE);
      if (!result.fired) continue;
      const dx = result.endPoint.x - result.origin.x;
      const dz = result.endPoint.z - result.origin.z;
      yawAngles.push(Math.atan2(dx, dz)); // yaw-plane angle of this shot, relative to world +Z
    }

    expect(yawAngles.length).toBeGreaterThanOrEqual(20);
    // Bounded: distribution never exceeds the configured spread constant --
    // never asserting an exact PRNG value, only the guaranteed bound.
    for (const angle of yawAngles) {
      expect(Math.abs(angle)).toBeLessThanOrEqual(MACHINEGUN_SPREAD_RADIANS + 1e-9);
    }
    // Varies: spread is actually applied, not a no-op -- not every shot landed
    // at the exact same angle.
    const distinctAngles = new Set(yawAngles.map((a) => a.toFixed(6)));
    expect(distinctAngles.size).toBeGreaterThan(1);
  });
});

describe('combat: per-weapon config resolves from heldWeapon (U1 foundation)', () => {
  it('an entity holding the machine gun fires with different damage than the pistol default', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'pistolShooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'mgShooter', { x: 20, y: 1, z: 0 });
    rig.world.getEntity('mgShooter').heldWeapon = 'machinegun';
    primeBroadPhase(rig);

    const pistolResult = rig.weaponSystem.resolveFire(rig.world.getEntity('pistolShooter'), FIRE);
    const mgResult = rig.weaponSystem.resolveFire(rig.world.getEntity('mgShooter'), HELD_FIRE);

    // The pistol's shipped damage must stay exactly 20 (R2: zero behavior
    // change) -- the machine gun's own value only needs to differ from it.
    expect(pistolResult.damage).toBe(20);
    expect(mgResult.damage).not.toBe(pistolResult.damage);
    expect(mgResult.damage).toBeGreaterThan(0);
  });

  it('the machine gun becomes ready to fire again sooner than the pistol does', () => {
    // cooldownTicks: 6 forces the pistol's real (non-test-shortcut) cadence
    // so this comparison is meaningful -- the shared rig's own default (0)
    // would make the pistol always-ready and hide the difference.
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'pistolShooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'mgShooter', { x: 20, y: 1, z: 0 });
    rig.world.getEntity('mgShooter').heldWeapon = 'machinegun';
    primeBroadPhase(rig);

    rig.weaponSystem.resolveFire(rig.world.getEntity('pistolShooter'), FIRE);
    rig.weaponSystem.resolveFire(rig.world.getEntity('mgShooter'), HELD_FIRE);

    let pistolReadyTick = null;
    let mgReadyTick = null;
    for (let tick = 1; tick <= 10 && (pistolReadyTick === null || mgReadyTick === null); tick++) {
      const pistolAgain = rig.weaponSystem.resolveFire(rig.world.getEntity('pistolShooter'), FIRE);
      const mgAgain = rig.weaponSystem.resolveFire(rig.world.getEntity('mgShooter'), HELD_FIRE);
      if (pistolAgain.fired && pistolReadyTick === null) pistolReadyTick = tick;
      if (mgAgain.fired && mgReadyTick === null) mgReadyTick = tick;
    }

    expect(mgReadyTick).toBeLessThan(pistolReadyTick);
  });
});

describe('combat: hit event carries damage and a damage-origin position (U1 foundation)', () => {
  it('carries the pistol damage and a damageOrigin equal to the shooter position for a hitscan hit', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
    const hitEvent = events.find((e) => e.type === 'hit');

    expect(hitEvent.damage).toBe(20);
    expect(hitEvent.damageOrigin).toEqual(hitEvent.shooterPosition);
    expect(hitEvent.damageOrigin).toEqual(rig.world.getEntity('shooter').position);

    // Main.js's damage indicator now reads event.damageOrigin instead of
    // event.shooterPosition -- since the two are the same value for a
    // hitscan hit, the indicator's computed bearing is unchanged.
    const angleFromShooterPosition = computeAngleFromPlayer(
      rig.world.getEntity('target').position,
      0,
      hitEvent.shooterPosition
    );
    const angleFromDamageOrigin = computeAngleFromPlayer(
      rig.world.getEntity('target').position,
      0,
      hitEvent.damageOrigin
    );
    expect(angleFromDamageOrigin).toBe(angleFromShooterPosition);
  });
});
