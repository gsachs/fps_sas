import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPickupSystem, PICKUP_COLLECTION_RADIUS, GRENADE_POCKET_CAPACITY } from '../../src/sim/pickups.js';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';
import { buildBotRig, primeBroadPhase } from '../support/rig.js';

await RAPIER.init();

const GRENADE_PICKUP = { id: 'gr', type: 'grenade', x: 10, y: 1, z: 0 };
const GRENADE_PICKUP_2 = { id: 'gr2', type: 'grenade', x: 20, y: 1, z: 0 };
const PLAYER_ID = 'player';

function makeEntity(overrides = {}) {
  return {
    id: 'e',
    position: { x: 0, y: 1, z: 0 },
    heldWeapon: 'machinegun',
    grenadeCount: 0,
    ...overrides,
  };
}

describe('pickups: type-gated collection (R7 seam for future items)', () => {
  it('a non-grenade pickup type is never collected, even by an otherwise-eligible player', () => {
    const otherPickup = { id: 'other', type: 'health', x: 10, y: 1, z: 0 };
    const system = createPickupSystem({ pickups: [otherPickup], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const player = makeEntity({ id: PLAYER_ID, position: { x: 10, y: 1, z: 0 } });

    system.tryCollect(player);

    expect(player.grenadeCount).toBe(0); // not silently treated as a grenade
    expect(system.getPickupStates().find((p) => p.id === 'other').taken).toBe(false);
  });
});

describe('pickups: grenade eligibility is player-only and pocket-capped (R7, R6, AE5)', () => {
  it('a bot never collects a grenade pickup, even in range', () => {
    const system = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: () => false });
    const bot = makeEntity({ id: 'bot0', position: { x: 10, y: 1, z: 0 } });

    system.tryCollect(bot);

    expect(bot.grenadeCount).toBe(0);
    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(false);
  });

  it('the player collects a grenade pickup in range, incrementing the pocket', () => {
    const system = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const player = makeEntity({ id: PLAYER_ID, position: { x: 10, y: 1, z: 0 } });

    system.tryCollect(player);

    expect(player.grenadeCount).toBe(1);
    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(true);
  });

  it('a full pocket leaves the pickup in place, uncollected (AE5)', () => {
    const system = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const player = makeEntity({ id: PLAYER_ID, position: { x: 10, y: 1, z: 0 }, grenadeCount: GRENADE_POCKET_CAPACITY });

    system.tryCollect(player);

    expect(player.grenadeCount).toBe(GRENADE_POCKET_CAPACITY);
    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(false);
  });

  it('collection succeeds again once the pocket has room below capacity', () => {
    const system = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const player = makeEntity({
      id: PLAYER_ID,
      position: { x: 10, y: 1, z: 0 },
      grenadeCount: GRENADE_POCKET_CAPACITY - 1,
    });

    system.tryCollect(player);

    expect(player.grenadeCount).toBe(GRENADE_POCKET_CAPACITY);
    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(true);
  });
});

describe('pickups: same-tick contention resolves by call order (KTD7)', () => {
  it('the first caller takes it; the second gets nothing', () => {
    // Both entities are eligible here (unlike the real game's single local
    // player) purely so contention has two real contenders to resolve
    // between -- the mechanism under test is call order, not eligibility.
    const system = createPickupSystem({
      pickups: [GRENADE_PICKUP],
      isLocalPlayer: (e) => e.id === 'first' || e.id === 'second',
    });
    const first = makeEntity({ id: 'first', position: { x: 10, y: 1, z: 0 } });
    const second = makeEntity({ id: 'second', position: { x: 10.1, y: 1, z: 0 } });

    system.tryCollect(first); // called first, mirroring main.js's player-first command Map
    system.tryCollect(second);

    expect(first.grenadeCount).toBe(1);
    expect(second.grenadeCount).toBe(0); // unaffected
    expect(system.getPickupStates().filter((p) => p.taken)).toHaveLength(1);
  });
});

describe('pickups: respawn countdown ticks at world scope (KTD5)', () => {
  it('restores a taken pickup once its countdown fully elapses, via tick() alone', () => {
    const system = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const player = makeEntity({ id: PLAYER_ID, position: { x: 10, y: 1, z: 0 } });
    system.tryCollect(player);
    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(true);

    // Ticking short of the full delay must not restore it early.
    for (let i = 0; i < 500; i++) system.tick();
    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(true);

    for (let i = 0; i < 100; i++) system.tick();
    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(false);
  });

  it('ticks with no entity commands involved at all -- an always-running world-scope loop', () => {
    const system = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const player = makeEntity({ id: PLAYER_ID, position: { x: 10, y: 1, z: 0 } });
    system.tryCollect(player);

    for (let i = 0; i < 600; i++) system.tick();

    expect(system.getPickupStates().find((p) => p.id === 'gr').taken).toBe(false);
    // Available again -- the same entity can now take it a second time.
    system.tryCollect(player);
    expect(player.grenadeCount).toBe(2);
  });
});

describe('pickups: resetAll restores every pickup and clears pending countdowns (R8)', () => {
  it('a taken pickup with a pending countdown becomes available again immediately', () => {
    const system = createPickupSystem({ pickups: [GRENADE_PICKUP, GRENADE_PICKUP_2], isLocalPlayer: () => true });
    system.tryCollect(makeEntity({ id: 'bot0', position: { x: 10, y: 1, z: 0 } }));
    system.tryCollect(makeEntity({ id: 'player', position: { x: 20, y: 1, z: 0 } }));
    expect(system.getPickupStates().every((p) => p.taken)).toBe(true);

    system.resetAll();

    expect(system.getPickupStates().every((p) => !p.taken)).toBe(true);
    // No leftover countdown either -- many ticks produce no further change.
    for (let i = 0; i < 700; i++) system.tick();
    expect(system.getPickupStates().every((p) => !p.taken)).toBe(true);
  });
});

describe('pickups: wired into world.step() (AE3, integration)', () => {
  it('the player walking over a grenade pickup holds it, and killing them does not restore the pickup early or empty the pocket', () => {
    const rig = buildBotRig({ spawnPoints: [{ x: 0, y: 1, z: 0 }] });
    const pickupSystem = createPickupSystem({
      pickups: [GRENADE_PICKUP],
      isLocalPlayer: (e) => e.id === PLAYER_ID,
    });
    const combat = {
      resolveFire: rig.weaponSystem.resolveFire,
      applyHit: rig.healthSystem.applyHit,
      tickRespawns: rig.healthSystem.tickRespawns,
    };
    const world = createWorld({ physics: rig.movementSystem, combat, pickups: pickupSystem });
    // Mirrors combat.test.js's own-world-plus-shared-rig-movementSystem
    // pattern: the rig's physics/weapon/health systems are reused, but this
    // test builds its own world (rig.world doesn't carry pickups) so entity
    // registration happens on both directly.
    rig.movementSystem.addCharacter('shooter', { x: 10, y: 1, z: -5 });
    world.addEntity('shooter', { position: { x: 10, y: 1, z: -5 } });
    rig.movementSystem.addCharacter(PLAYER_ID, { x: 10, y: 1, z: 0 });
    world.addEntity(PLAYER_ID, { position: { x: 10, y: 1, z: 0 } });
    primeBroadPhase(rig);

    const idle = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false } });
    // Forward at yaw 0 is +z (movement.js's convention) -- shooter behind at
    // z=-5 aimed at the player at z=0 lands without needing any pitch.
    const fire = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: true, jump: false, throwGrenade: false } });

    // A single step: the player sits on the pickup and takes it.
    world.step(new Map([[PLAYER_ID, idle]]), 1 / 60);

    expect(world.getEntity(PLAYER_ID).grenadeCount).toBe(1);
    expect(pickupSystem.getPickupStates()[0].taken).toBe(true);

    // Kill the player.
    for (let i = 0; i < 60 && !world.getEntity(PLAYER_ID).dead; i++) {
      world.step(new Map([['shooter', fire], [PLAYER_ID, idle]]), 1 / 60);
    }

    expect(world.getEntity(PLAYER_ID).dead).toBe(true);
    // AE3: the grenade pocket survives death -- only match reset empties it.
    // The taken pickup itself stays taken; its own countdown, started at the
    // original take, is unaffected by the kill.
    expect(world.getEntity(PLAYER_ID).grenadeCount).toBe(1);
    expect(world.getEntity(PLAYER_ID).heldWeapon).toBe('machinegun'); // AE3: no downgrade on death
    expect(pickupSystem.getPickupStates()[0].taken).toBe(true);

    // The countdown restores it on schedule.
    for (let i = 0; i < 600; i++) pickupSystem.tick();
    expect(pickupSystem.getPickupStates()[0].taken).toBe(false);
  });

  it('a dead entity is excluded from collection by world.step\'s own dead-entity guard, before pickups.js is ever reached', () => {
    const pickupSystem = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const world = createWorld({ pickups: pickupSystem });
    world.addEntity(PLAYER_ID, { position: { x: 10, y: 1, z: 0 } });
    world.getEntity(PLAYER_ID).dead = true;
    const idle = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false } });

    world.step(new Map([[PLAYER_ID, idle]]), 1 / 60);

    expect(world.getEntity(PLAYER_ID).grenadeCount).toBe(0);
    expect(pickupSystem.getPickupStates()[0].taken).toBe(false);
  });

  it('a parked/inactive entity with no command in the map at all is never visited -- the real KTD7 mechanism', () => {
    const pickupSystem = createPickupSystem({ pickups: [GRENADE_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const world = createWorld({ pickups: pickupSystem });
    // Sitting exactly on the pickup, alive -- but main.js's gatherCommands
    // never puts an inactive/parked bot's id into the commands Map, so
    // world.step's for-of loop simply never iterates it.
    world.addEntity(PLAYER_ID, { position: { x: 10, y: 1, z: 0 } });

    world.step(new Map(), 1 / 60);

    expect(world.getEntity(PLAYER_ID).grenadeCount).toBe(0);
    expect(pickupSystem.getPickupStates()[0].taken).toBe(false);
  });
});
