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

// The machine gun is the only weapon and gates on the held-fire level, not
// the edge latch (KTD2) -- every firing command in this file sets fireHeld.
const FIRE = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: true, jump: false, throwGrenade: false } });
const HOLD = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false } });

describe('combat: kill, score, and respawn (AE1)', () => {
  it('kills the target after enough hits, credits the shooter once, and respawns the target with full health', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 20 }];
    const rig = buildBotRig({ spawnPoints });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    for (let i = 0; i < 60 && !rig.world.getEntity('target').dead; i++) {
      rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
    }

    expect(rig.world.getEntity('target').dead).toBe(true);
    expect(rig.world.getEntity('target').health).toBe(0);
    expect(rig.world.getEntity('shooter').score).toBe(1);
    // AE3: death leaves the held weapon unchanged -- no downgrade exists.
    expect(rig.world.getEntity('target').heldWeapon).toBe('machinegun');
    expect(rig.world.getEntity('target').ammo).toBeUndefined();

    for (let i = 0; i < 181; i++) {
      rig.world.step(new Map([['shooter', HOLD], ['target', HOLD]]), 1 / 60);
    }

    const target = rig.world.getEntity('target');
    expect(target.dead).toBe(false);
    expect(target.health).toBe(100);
    expect(target.heldWeapon).toBe('machinegun'); // AE3: still holding the infinite MG post-respawn
  });
});

describe('combat: a corpse does not block bullets or line of sight', () => {
  it('lets a shot pass through a corpse to hit whoever is standing behind it', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 20 }, { x: 40, y: 1, z: 40 }];
    const rig = buildBotRig({ spawnPoints });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'victim', { x: 0, y: 1, z: 5 });
    addEntity(rig, 'bystander', { x: 0, y: 1, z: 10 });
    primeBroadPhase(rig);

    // Kill the victim, who stands directly between the shooter and the
    // bystander -- while alive, this shot would land on the victim.
    for (let i = 0; i < 60 && !rig.world.getEntity('victim').dead; i++) {
      rig.world.step(new Map([['shooter', FIRE], ['victim', HOLD], ['bystander', HOLD]]), 1 / 60);
    }
    expect(rig.world.getEntity('victim').dead).toBe(true);

    // Keep firing the same direction. A live corpse-collider would keep
    // absorbing every shot; the bystander behind it must still take damage.
    for (let i = 0; i < 20 && rig.world.getEntity('bystander').health === 100; i++) {
      rig.world.step(new Map([['shooter', FIRE], ['victim', HOLD], ['bystander', HOLD]]), 1 / 60);
    }

    expect(rig.world.getEntity('bystander').health).toBeLessThan(100);
  });
});

describe('combat: respawn continues arena state (AE2)', () => {
  it('restores the respawned entity without resetting unrelated entities', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 20 }];
    const rig = buildBotRig({ spawnPoints });
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
    const rig = buildBotRig();
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 50, y: 1, z: 50 }); // well outside the ray's path
    primeBroadPhase(rig);

    rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    expect(rig.world.getEntity('target').health).toBe(100);
  });
});

describe('combat: step() reports fire and hit events (U7 feedback source)', () => {
  it('reports a fire event even on a miss, with no accompanying hit event', () => {
    const rig = buildBotRig();
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
    const rig = buildBotRig();
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
    expect(hitEvent).toMatchObject({ shooterId: 'shooter', targetId: 'target', damage: 12, killed: false });
  });

  it('reports no events when nobody fires', () => {
    const rig = buildBotRig();
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
    // The machine gun's spread must not jitter this shot off-target -- a
    // fixed random() of 0.5 zeroes the jitter (see weapon.js's formula),
    // keeping the shot exactly on the geometric edge this test probes.
    const rig = buildBotRig({ random: () => 0.5 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: edgeOffset, y: 1, z: 5 }); // shooter fires straight down x=0
    primeBroadPhase(rig);

    rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);

    expect(rig.world.getEntity('target').health).toBeLessThan(100);
  });
});

describe('combat: self-hit exclusion', () => {
  it('excludes the shooter from its own hitscan ray', () => {
    const rig = buildBotRig();
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), FIRE);

    expect(result.hitEntityId).not.toBe('shooter');
  });
});

describe('combat: simultaneous lethal hits credit exactly one killer', () => {
  it('does not double-count a kill when two shooters land lethal hits in the same tick', () => {
    const spawnPoints = [{ x: 0, y: 1, z: 0 }];
    const rig = buildBotRig({ spawnPoints, cooldownTicks: 0 });
    addEntity(rig, 'shooterA', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'shooterB', { x: 0, y: 1, z: 10 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    rig.world.getEntity('target').health = 15; // one hit (12 dmg) is not lethal alone, but both landing this tick is
    primeBroadPhase(rig);

    const fireAtTarget = createCommand({ yaw: 0, pitch: 0, buttons: { fireHeld: true, jump: false } });
    const fireAtTargetFromB = createCommand({ yaw: Math.PI, pitch: 0, buttons: { fireHeld: true, jump: false } });

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

describe('combat: shots resolve at the weapon\'s per-tick cooldown rate across a multi-tick frame (framerate independence)', () => {
  it('fires exactly as many times as the cooldown allows within one long frame delta, not once per frame', () => {
    // gatherCommands is called fresh every fixed sub-step (sim/index.js), so
    // the held-fire level is re-read each tick -- a long frame delta that
    // spans several sim ticks must fire once per cooldown window elapsed,
    // never more (a per-frame bug) and never just once regardless of how
    // many ticks ran (which would be the edge-latch shape, not held-fire).
    const rig = buildBotRig({ cooldownTicks: 2 }); // the machine gun's real cadence
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

    sampler.onFirePressed(); // starts the held-fire level; never released
    // A long frame delta forces the fixed-step loop to run several ticks in
    // this single tick() call -- at cooldownTicks: 2, ticks 0/2/4 fire.
    combatSim.tick(5 / 60);

    expect(combatSim.world.getEntity('target').health).toBe(64); // exactly 3 shots x 12 damage
  });
});

describe('combat: machine gun sprays every cooldown window while held, with no ammo or revert (AE3, R6)', () => {
  it('keeps firing indefinitely at the configured cooldown rate, never reverting or tracking ammo', () => {
    const rig = buildBotRig({ cooldownTicks: 4 });
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    let shotsFired = 0;
    for (let tick = 0; tick < 20; tick++) {
      const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), FIRE);
      if (result.fired) shotsFired += 1;
    }

    expect(shotsFired).toBe(5); // fires at ticks 0, 4, 8, 12, 16 -- period matches cooldownTicks, never stops
    expect(rig.world.getEntity('shooter').heldWeapon).toBe('machinegun'); // no revert -- no other weapon exists
    expect(rig.world.getEntity('shooter').ammo).toBeUndefined(); // no ammo field exists at all
  });
});

describe('combat: machine-gun spread (R1, KTD2)', () => {
  it('consecutive shots from a fixed pose vary in direction but stay within the configured spread bound', () => {
    const rig = buildBotRig();
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    const yawAngles = [];
    for (let tick = 0; tick < 100 && yawAngles.length < 20; tick++) {
      const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), FIRE);
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

describe('combat: an unknown or unset heldWeapon resolves to the default machine gun (U1 foundation)', () => {
  it('fires with the default config when heldWeapon is unset', () => {
    const rig = buildBotRig();
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    const result = rig.weaponSystem.resolveFire(rig.world.getEntity('shooter'), FIRE);

    expect(result.weapon).toBe('machinegun');
    expect(result.damage).toBe(12);
  });
});

describe('combat: hit event carries damage and a damage-origin position (U1 foundation)', () => {
  it('carries the machine-gun damage and a damageOrigin equal to the shooter position for a hitscan hit', () => {
    const rig = buildBotRig();
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
    const hitEvent = events.find((e) => e.type === 'hit');

    expect(hitEvent.damage).toBe(12);
    expect(hitEvent.damageOrigin).toEqual(hitEvent.shooterPosition);
    expect(hitEvent.damageOrigin).toEqual(rig.world.getEntity('shooter').position);

    // Main.js's damage indicator reads event.damageOrigin instead of
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

describe('combat: hit event carries the weapon used (R7, U1 foundation)', () => {
  it('reads machinegun for every shot, the only weapon in the game', () => {
    const rig = buildBotRig();
    addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
    addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
    primeBroadPhase(rig);

    const events = rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
    const hitEvent = events.find((e) => e.type === 'hit');

    expect(hitEvent.weapon).toBe('machinegun');
  });
});
