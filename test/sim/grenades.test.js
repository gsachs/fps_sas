import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  createGrenadeSystem,
  GRENADE_FUSE_TICKS,
  GRENADE_THROW_SPEED,
  GRENADE_PITCH_UPWARD_BIAS_RADIANS,
  BLAST_RADIUS,
} from '../../src/sim/grenades.js';
import { createCommand } from '../../src/sim/command.js';
import { createWorld } from '../../src/sim/world.js';
import { resetMatch } from '../../src/shell/matchEnd.js';
import { buildBotRig, addEntity, primeBroadPhase } from '../support/rig.js';

await RAPIER.init();

const TICK_DT = 1 / 60;
const THROW_COMMAND = createCommand({
  yaw: 0,
  pitch: 0,
  buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: true },
});
const IDLE_COMMAND = createCommand({
  yaw: 0,
  pitch: 0,
  buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false },
});

// A wall placed directly ahead of a thrower standing at the origin facing
// yaw 0 (the throw direction drifts only in y and z, never x, at yaw 0) --
// close enough that the grenade lands against it within a handful of ticks,
// giving every test in this file a fast, real-Rapier-geometry-backed landing
// instead of an unbounded free-fall arc.
function buildStopperRig() {
  return buildBotRig({ obstacles: [{ x: 0, y: 2, z: 2, hx: 1, hy: 3, hz: 0.5 }] });
}

// Throws once for `throwerId` and ticks the grenade system directly (not via
// world.step()) until it lands against the stopper wall, returning the
// landed blast-center position. Tests read this position back rather than
// predicting the arc's landing spot by hand.
function throwAndLand(rig, grenadeSystem, throwerId, throwerPosition, grenadeCount = 1) {
  rig.world.addEntity(throwerId, { position: { ...throwerPosition }, grenadeCount });
  const thrower = rig.world.getEntity(throwerId);

  const thrown = grenadeSystem.tryThrow(thrower, THROW_COMMAND);
  expect(thrown).toBeTruthy();

  let blastCenter = null;
  for (let i = 0; i < 60 && !blastCenter; i++) {
    grenadeSystem.tick(rig.world, TICK_DT);
    const [grenade] = grenadeSystem.getInFlightGrenades();
    if (grenade?.landed) blastCenter = grenade.position;
  }
  expect(blastCenter).toBeTruthy();
  return blastCenter;
}

describe('grenades: throw consumes the pocket (R3, R13 boundary)', () => {
  it('a successful throw decrements grenadeCount by exactly one and creates one in-flight grenade', () => {
    const grenadeSystem = createGrenadeSystem({});
    const entity = { id: 'p', position: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, grenadeCount: 2 };

    const result = grenadeSystem.tryThrow(entity, THROW_COMMAND);

    expect(result).toBeTruthy();
    expect(entity.grenadeCount).toBe(1);
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(1);
  });

  it('an empty pocket throws nothing and leaves the count untouched', () => {
    const grenadeSystem = createGrenadeSystem({});
    const entity = { id: 'p', position: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, grenadeCount: 0 };

    const result = grenadeSystem.tryThrow(entity, THROW_COMMAND);

    expect(result).toBeNull();
    expect(entity.grenadeCount).toBe(0);
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(0);
  });

  it('no throwGrenade edge is a no-op even with grenades in the pocket', () => {
    const grenadeSystem = createGrenadeSystem({});
    const entity = { id: 'p', position: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, grenadeCount: 3 };

    grenadeSystem.tryThrow(entity, IDLE_COMMAND);

    expect(entity.grenadeCount).toBe(3);
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(0);
  });
});

describe('grenades: arc under gravity and landing (R3)', () => {
  it("the thrown grenade's y rises then falls before it lands", () => {
    const rig = buildBotRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    rig.world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });

    grenadeSystem.tryThrow(rig.world.getEntity('thrower'), THROW_COMMAND);

    const ys = [];
    for (let i = 0; i < 200; i++) {
      grenadeSystem.tick(rig.world, TICK_DT);
      const [grenade] = grenadeSystem.getInFlightGrenades();
      if (!grenade) break;
      ys.push(grenade.position.y);
      if (grenade.landed) break;
    }

    expect(ys.length).toBeGreaterThan(2);
    const peakIndex = ys.indexOf(Math.max(...ys));
    // A peak strictly inside the sequence proves rise-then-fall, not a
    // monotonic climb or a monotonic drop.
    expect(peakIndex).toBeGreaterThan(0);
    expect(peakIndex).toBeLessThan(ys.length - 1);
    // Lands close to (not past) the floor it hit -- the swept ray's contact
    // tolerance, not a fall clean through it.
    const landedY = ys[ys.length - 1];
    expect(landedY).toBeGreaterThanOrEqual(-0.01);
    expect(landedY).toBeLessThan(1);
  });

  it('never crosses a thin wall segment between ticks even at maximum throw speed', () => {
    const WALL_Z = 0.5;
    const WALL_HALF_THICKNESS = 0.05; // thinner than one tick's travel at GRENADE_THROW_SPEED
    const perTickTravel = GRENADE_THROW_SPEED / 60;
    expect(perTickTravel).toBeGreaterThan(WALL_HALF_THICKNESS * 2); // sanity: naive per-tick checks would tunnel here

    const rig = buildBotRig({ obstacles: [{ x: 0, y: 1, z: WALL_Z, hx: 5, hy: 5, hz: WALL_HALF_THICKNESS }] });
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    rig.world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });

    grenadeSystem.tryThrow(rig.world.getEntity('thrower'), THROW_COMMAND);

    let landed = false;
    for (let i = 0; i < 10 && !landed; i++) {
      grenadeSystem.tick(rig.world, TICK_DT);
      landed = grenadeSystem.getInFlightGrenades()[0]?.landed ?? false;
    }

    expect(landed).toBe(true);
    const [grenade] = grenadeSystem.getInFlightGrenades();
    // Stopped at or short of the wall's near face -- never past it.
    expect(grenade.position.z).toBeLessThanOrEqual(WALL_Z - WALL_HALF_THICKNESS + 1e-6);
  });
});

describe('grenades: passes through characters -- only world geometry stops the arc (finding #9)', () => {
  it('does not land against a character standing in its path, and keeps flying past them', () => {
    const rig = buildBotRig();
    const grenadeSystem = createGrenadeSystem({
      rapierWorld: rig.rapierWorld,
      healthSystem: rig.healthSystem,
      movementSystem: rig.movementSystem,
    });
    // A level throw (pitch cancels the module's own upward bias) so the
    // grenade travels roughly at the bystander's own capsule height instead
    // of arcing over them.
    rig.world.addEntity('thrower', {
      position: { x: 0, y: 1, z: 0 },
      pitch: -GRENADE_PITCH_UPWARD_BIAS_RADIANS,
      grenadeCount: 1,
    });
    addEntity(rig, 'bystander', { x: 0, y: 1, z: 3 }); // directly in the throw's path
    primeBroadPhase(rig); // must run after the bystander's collider is created

    const thrown = grenadeSystem.tryThrow(rig.world.getEntity('thrower'), THROW_COMMAND);
    expect(thrown).toBeTruthy();

    // Old behavior: this sweep would hit the bystander's capsule around
    // z=3 and latch `landed` there, freezing the grenade mid-air. It must
    // instead fly straight through.
    for (let i = 0; i < 20; i++) {
      grenadeSystem.tick(rig.world, TICK_DT);
      expect(grenadeSystem.getInFlightGrenades()[0].landed).toBe(false);
    }

    const [grenade] = grenadeSystem.getInFlightGrenades();
    expect(grenade.position.z).toBeGreaterThan(3);
  });
});

describe('grenades: fuse is a tick countdown (KTD5)', () => {
  it('detonates on exactly the GRENADE_FUSE_TICKS-th tick() call, and only once', () => {
    const rig = buildBotRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    rig.world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });
    grenadeSystem.tryThrow(rig.world.getEntity('thrower'), THROW_COMMAND);

    for (let i = 0; i < GRENADE_FUSE_TICKS - 1; i++) {
      const events = grenadeSystem.tick(rig.world, TICK_DT);
      expect(events).toEqual([]);
    }
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(1);

    const detonationEvents = grenadeSystem.tick(rig.world, TICK_DT);
    expect(detonationEvents.some((e) => e.type === 'explosion')).toBe(true);
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(0);

    // A second call after detonation produces nothing further -- the blast
    // applied exactly once, not once per subsequent tick.
    const afterEvents = grenadeSystem.tick(rig.world, TICK_DT);
    expect(afterEvents).toEqual([]);
  });

  it('a paused sim (tick() simply not called) does not burn fuse', () => {
    const grenadeSystem = createGrenadeSystem({});
    const entity = { id: 'p', position: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, grenadeCount: 1 };
    grenadeSystem.tryThrow(entity, THROW_COMMAND);

    const before = grenadeSystem.getInFlightGrenades()[0].fuseTicksRemaining;
    // No tick() calls here at all -- standing in for "time passes while
    // paused."
    const after = grenadeSystem.getInFlightGrenades()[0].fuseTicksRemaining;

    expect(after).toBe(before);
    expect(before).toBe(GRENADE_FUSE_TICKS);
  });
});

describe('grenades: blast (AE2, KTD4) -- radius, line-of-sight, falloff, self-damage-no-credit', () => {
  it('kills two bots in LOS, leaves a same-distance wall-blocked bot untouched, and damages the thrower without crediting the kill to itself', () => {
    const rig = buildStopperRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });

    const blastCenter = throwAndLand(rig, grenadeSystem, 'thrower', { x: 0, y: 1, z: 0 });

    const DISTANCE = 1.2; // same magnitude for all three "at range" entities below
    rig.world.addEntity('victim1', { position: { x: blastCenter.x + DISTANCE, y: blastCenter.y, z: blastCenter.z } });
    rig.world.addEntity('victim2', { position: { x: blastCenter.x - DISTANCE, y: blastCenter.y, z: blastCenter.z } });
    // Behind the same stopper wall the grenade just landed against -- the
    // wall's far face sits past z: 2.5, so z: blastCenter.z + DISTANCE
    // (~2.67) is genuinely on the other side of it.
    rig.world.addEntity('blocked', { position: { x: blastCenter.x, y: blastCenter.y, z: blastCenter.z + DISTANCE } });
    rig.world.getEntity('victim1').health = 50; // falloff damage at this range isn't 100; make it unambiguously lethal
    rig.world.getEntity('victim2').health = 50;

    let finalEvents = [];
    for (let i = 0; i < GRENADE_FUSE_TICKS && finalEvents.length === 0; i++) {
      finalEvents = grenadeSystem.tick(rig.world, TICK_DT);
    }

    expect(rig.world.getEntity('victim1').dead).toBe(true);
    expect(rig.world.getEntity('victim2').dead).toBe(true);
    expect(rig.world.getEntity('blocked').health).toBe(100); // wall blocked it entirely
    expect(rig.world.getEntity('blocked').dead).toBe(false);

    const thrower = rig.world.getEntity('thrower');
    expect(thrower.health).toBeLessThan(100); // inside the radius, damaged too
    expect(thrower.dead).toBe(false);
    expect(thrower.score).toBe(2); // credited for both kills

    const hitEvents = finalEvents.filter((e) => e.type === 'hit');
    expect(hitEvents).toHaveLength(3); // victim1, victim2, thrower -- not the blocked bot
    for (const hit of hitEvents) {
      // R11: damage-direction feedback points at the blast center, never the
      // thrower's live position.
      expect(hit.damageOrigin).toEqual(blastCenter);
      // R7: a blast kill reads as a grenade kill, not whatever the thrower
      // happens to be holding.
      expect(hit.weapon).toBe('grenade');
    }
    expect(finalEvents.some((e) => e.type === 'explosion')).toBe(true);
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(0);
  });

  it('a parked entity at y: -100 is untouched -- distance alone excludes it', () => {
    const rig = buildStopperRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });

    throwAndLand(rig, grenadeSystem, 'thrower', { x: 0, y: 1, z: 0 });
    rig.world.addEntity('parked', { position: { x: 0, y: -100, z: 0 } });

    let finalEvents = [];
    for (let i = 0; i < GRENADE_FUSE_TICKS && finalEvents.length === 0; i++) {
      finalEvents = grenadeSystem.tick(rig.world, TICK_DT);
    }

    expect(rig.world.getEntity('parked').health).toBe(100);
    expect(rig.world.getEntity('parked').dead).toBe(false);
    expect(finalEvents.some((e) => e.type === 'hit' && e.targetId === 'parked')).toBe(false);
  });

  it('a thrower who dies mid-fuse still gets credited when the blast later kills someone else', () => {
    const rig = buildStopperRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });

    const blastCenter = throwAndLand(rig, grenadeSystem, 'thrower', { x: 0, y: 1, z: 0 });
    rig.world.addEntity('victim', { position: { x: blastCenter.x + 1, y: blastCenter.y, z: blastCenter.z } });
    rig.world.getEntity('victim').health = 20;

    const thrower = rig.world.getEntity('thrower');
    thrower.dead = true;
    thrower.health = 0;

    let finalEvents = [];
    for (let i = 0; i < GRENADE_FUSE_TICKS && finalEvents.length === 0; i++) {
      finalEvents = grenadeSystem.tick(rig.world, TICK_DT);
    }

    expect(rig.world.getEntity('victim').dead).toBe(true);
    expect(thrower.score).toBe(1); // credited despite being dead at detonation time
  });
});

describe('grenades: match reset clears in-flight projectiles (R8, AE4)', () => {
  it('a frozen mid-air grenade is gone after resetAll(), and no later tick() detonates it', () => {
    const rig = buildBotRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    rig.world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });
    grenadeSystem.tryThrow(rig.world.getEntity('thrower'), THROW_COMMAND);

    for (let i = 0; i < 10; i++) grenadeSystem.tick(rig.world, TICK_DT); // still mid-flight, fuse not expired
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(1);

    grenadeSystem.resetAll();
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(0);

    for (let i = 0; i < GRENADE_FUSE_TICKS + 10; i++) {
      const events = grenadeSystem.tick(rig.world, TICK_DT);
      expect(events).toEqual([]);
    }
  });

  it('resetMatch clears in-flight grenades via the optional grenadeSystem param', () => {
    const rig = buildBotRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    rig.world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });
    grenadeSystem.tryThrow(rig.world.getEntity('thrower'), THROW_COMMAND);
    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(1);

    resetMatch(rig.world, {
      rapierWorld: rig.rapierWorld,
      spawnPoints: [{ x: 0, y: 1, z: 0 }],
      movementSystem: rig.movementSystem,
      healthSystem: rig.healthSystem,
      grenadeSystem,
    });

    expect(grenadeSystem.getInFlightGrenades()).toHaveLength(0);
  });
});

describe('grenades: pocket survives in-match respawn, empties only on match reset (R13/R8 boundary)', () => {
  it('a death+respawn leaves the remaining pocket untouched; only resetMatch zeroes it', () => {
    const rig = buildBotRig({ cooldownTicks: 6 });
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    // rig.world has no grenades wired in -- build our own world with it,
    // mirroring pickups.test.js's own-world-plus-shared-rig pattern.
    const combat = {
      resolveFire: rig.weaponSystem.resolveFire,
      applyHit: rig.healthSystem.applyHit,
      tickRespawns: rig.healthSystem.tickRespawns,
      tickAirdrops: rig.healthSystem.tickAirdrops,
    };
    const world = createWorld({ physics: rig.movementSystem, combat, grenades: grenadeSystem });
    world.addEntity('player', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 2 });
    rig.movementSystem.addCharacter('player', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    world.step(new Map([['player', THROW_COMMAND]]), TICK_DT);
    expect(world.getEntity('player').grenadeCount).toBe(1);
    grenadeSystem.resetAll(); // clear the just-thrown projectile so it can't interfere below

    rig.healthSystem.applyHit(world, 'player', null, 999); // direct kill, in-match
    expect(world.getEntity('player').dead).toBe(true);
    for (let i = 0; i < 180; i++) rig.healthSystem.tickRespawns(world, []);
    expect(world.getEntity('player').dead).toBe(false); // respawned in-match, not match reset

    expect(world.getEntity('player').grenadeCount).toBe(1); // untouched by death+respawn

    world.getEntity('player').grenadeCount = 3; // simulate picking up more since respawning
    resetMatch(world, {
      rapierWorld: rig.rapierWorld,
      spawnPoints: [{ x: 0, y: 1, z: 0 }],
      movementSystem: rig.movementSystem,
      healthSystem: rig.healthSystem,
      grenadeSystem,
    });
    expect(world.getEntity('player').grenadeCount).toBe(0); // only match reset empties it
  });
});

describe('grenades: wired into world.step() -- a single step() call resolves a landed blast synchronously', () => {
  it("a multi-kill blast's hit and explosion events are present in the same step() call that detonates it", () => {
    const rig = buildStopperRig();
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    const combat = {
      resolveFire: rig.weaponSystem.resolveFire,
      applyHit: rig.healthSystem.applyHit,
      tickRespawns: rig.healthSystem.tickRespawns,
      tickAirdrops: rig.healthSystem.tickAirdrops,
    };
    const world = createWorld({ physics: rig.movementSystem, combat, grenades: grenadeSystem });
    world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });
    rig.movementSystem.addCharacter('thrower', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    world.step(new Map([['thrower', THROW_COMMAND]]), TICK_DT);

    let blastCenter = null;
    for (let i = 0; i < 60 && !blastCenter; i++) {
      world.step(new Map([['thrower', IDLE_COMMAND]]), TICK_DT);
      const [grenade] = grenadeSystem.getInFlightGrenades();
      if (grenade?.landed) blastCenter = grenade.position;
    }
    expect(blastCenter).toBeTruthy();

    world.addEntity('victim', { position: { x: blastCenter.x + 1, y: blastCenter.y, z: blastCenter.z } });
    world.getEntity('victim').health = 20;

    let lastEvents = [];
    for (let i = 0; i < GRENADE_FUSE_TICKS && !world.getEntity('victim').dead; i++) {
      lastEvents = world.step(new Map([['thrower', IDLE_COMMAND]]), TICK_DT);
    }

    expect(world.getEntity('victim').dead).toBe(true);
    // The very step() call that killed the victim already carries the hit
    // and explosion events -- no follow-up call needed to observe them.
    expect(lastEvents.some((e) => e.type === 'hit' && e.targetId === 'victim' && e.killed)).toBe(true);
    expect(lastEvents.some((e) => e.type === 'explosion')).toBe(true);
  });
});

describe('grenades: a blast kill processes through the shared kill-event pass, same as a gunshot kill (R6, R7)', () => {
  it('a blast-killed victim produces a proper killed hit event and keeps holding the machine gun -- no downgrade exists', () => {
    const rig = buildStopperRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    const combat = {
      resolveFire: rig.weaponSystem.resolveFire,
      applyHit: rig.healthSystem.applyHit,
      tickRespawns: rig.healthSystem.tickRespawns,
      tickAirdrops: rig.healthSystem.tickAirdrops,
    };
    const world = createWorld({ physics: rig.movementSystem, combat, grenades: grenadeSystem });
    world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });
    rig.movementSystem.addCharacter('thrower', { x: 0, y: 1, z: 0 });
    primeBroadPhase(rig);

    world.step(new Map([['thrower', THROW_COMMAND]]), TICK_DT);

    let blastCenter = null;
    for (let i = 0; i < 60 && !blastCenter; i++) {
      world.step(new Map([['thrower', IDLE_COMMAND]]), TICK_DT);
      const [grenade] = grenadeSystem.getInFlightGrenades();
      if (grenade?.landed) blastCenter = grenade.position;
    }
    expect(blastCenter).toBeTruthy();

    world.addEntity('victim', {
      position: { x: blastCenter.x + 1, y: blastCenter.y, z: blastCenter.z },
      heldWeapon: 'machinegun',
    });
    world.getEntity('victim').health = 20;

    let killingEvents = [];
    for (let i = 0; i < GRENADE_FUSE_TICKS && !world.getEntity('victim').dead; i++) {
      killingEvents = world.step(new Map([['thrower', IDLE_COMMAND]]), TICK_DT);
    }

    expect(world.getEntity('victim').dead).toBe(true);
    // Regression guard for the death-strip bypass class: a blast kill must
    // resolve through the same shared kill-event pass as a gunshot kill,
    // not a separate path that could (re)introduce inconsistent handling.
    expect(killingEvents.some((e) => e.type === 'hit' && e.targetId === 'victim' && e.killed)).toBe(true);
    // AE3/R6: no weapon downgrade exists, blast kill or otherwise.
    expect(world.getEntity('victim').heldWeapon).toBe('machinegun');
    expect(world.getEntity('victim').ammo).toBeUndefined();
  });
});

describe('grenades: BLAST_RADIUS sanity (supplement)', () => {
  it('an entity just past BLAST_RADIUS takes no damage even with clear line of sight', () => {
    const rig = buildBotRig();
    primeBroadPhase(rig);
    const grenadeSystem = createGrenadeSystem({ rapierWorld: rig.rapierWorld, healthSystem: rig.healthSystem, movementSystem: rig.movementSystem });
    rig.world.addEntity('thrower', { position: { x: 0, y: 1, z: 0 }, grenadeCount: 1 });
    grenadeSystem.tryThrow(rig.world.getEntity('thrower'), THROW_COMMAND);

    // Let it land in the open, then place a bystander just outside the
    // blast radius on flat, unobstructed ground.
    let blastCenter = null;
    for (let i = 0; i < 200 && !blastCenter; i++) {
      grenadeSystem.tick(rig.world, TICK_DT);
      const [grenade] = grenadeSystem.getInFlightGrenades();
      if (grenade?.landed) blastCenter = grenade.position;
    }
    expect(blastCenter).toBeTruthy();

    rig.world.addEntity('bystander', {
      position: { x: blastCenter.x + BLAST_RADIUS + 1, y: blastCenter.y, z: blastCenter.z },
    });

    let finalEvents = [];
    for (let i = 0; i < GRENADE_FUSE_TICKS && finalEvents.length === 0; i++) {
      finalEvents = grenadeSystem.tick(rig.world, TICK_DT);
    }

    expect(rig.world.getEntity('bystander').health).toBe(100);
    expect(finalEvents.some((e) => e.type === 'hit' && e.targetId === 'bystander')).toBe(false);
  });
});
