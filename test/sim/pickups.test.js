import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPickupSystem, PICKUP_COLLECTION_RADIUS, GRENADE_POCKET_CAPACITY } from '../../src/sim/pickups.js';
import { MACHINEGUN_MAX_AMMO } from '../../src/sim/weapon.js';
import { createWorld } from '../../src/sim/world.js';
import { createCommand } from '../../src/sim/command.js';
import { buildBotRig, primeBroadPhase } from '../support/rig.js';

await RAPIER.init();

const MG_PICKUP = { id: 'mg', type: 'machinegun', x: 0, y: 1, z: 0 };
const GRENADE_PICKUP = { id: 'gr', type: 'grenade', x: 10, y: 1, z: 0 };
const PLAYER_ID = 'player';

function makeEntity(overrides = {}) {
  return {
    id: 'e',
    position: { x: 0, y: 1, z: 0 },
    heldWeapon: 'pistol',
    ammo: null,
    grenadeCount: 0,
    ...overrides,
  };
}

describe('pickups: machine-gun collection (AE3, R6)', () => {
  it('grants full ammo and swaps heldWeapon for any entity within range', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const bot = makeEntity({ id: 'bot0', position: { x: 0.2, y: 1, z: 0 } });

    system.tryCollect(bot);

    expect(bot.heldWeapon).toBe('machinegun');
    expect(bot.ammo).toBe(MACHINEGUN_MAX_AMMO);
    expect(system.getPickupStates().find((p) => p.id === 'mg').taken).toBe(true);
  });

  it('refills to max even if the entity already partially holds the machine gun', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const bot = makeEntity({ id: 'bot0', position: { x: 0, y: 1, z: 0 }, heldWeapon: 'machinegun', ammo: 3 });

    system.tryCollect(bot);

    expect(bot.ammo).toBe(MACHINEGUN_MAX_AMMO);
  });

  it('does not collect a pickup outside the collection radius', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const bot = makeEntity({ id: 'bot0', position: { x: PICKUP_COLLECTION_RADIUS + 1, y: 1, z: 0 } });

    system.tryCollect(bot);

    expect(bot.heldWeapon).toBe('pistol');
    expect(system.getPickupStates().find((p) => p.id === 'mg').taken).toBe(false);
  });

  it('the 3D distance gate holds regardless of a far-off y (parked-entity mechanism)', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const parked = makeEntity({ id: 'parked', position: { x: 0, y: -100, z: 0 } });

    system.tryCollect(parked);

    expect(parked.heldWeapon).toBe('pistol');
    expect(system.getPickupStates().find((p) => p.id === 'mg').taken).toBe(false);
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
  it('the first caller (player, per command-map order) takes it; the second gets nothing', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: (e) => e.id === PLAYER_ID });
    const player = makeEntity({ id: PLAYER_ID, position: { x: 0, y: 1, z: 0 } });
    const bot = makeEntity({ id: 'bot0', position: { x: 0.1, y: 1, z: 0 } });

    system.tryCollect(player); // called first, mirroring main.js's player-first command Map
    system.tryCollect(bot);

    expect(player.heldWeapon).toBe('machinegun');
    expect(bot.heldWeapon).toBe('pistol'); // unaffected
    expect(system.getPickupStates().filter((p) => p.taken)).toHaveLength(1);
  });
});

describe('pickups: respawn countdown ticks at world scope (KTD5)', () => {
  it('restores a taken pickup once its countdown fully elapses, via tick() alone', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const bot = makeEntity({ id: 'bot0', position: { x: 0, y: 1, z: 0 } });
    system.tryCollect(bot);
    expect(system.getPickupStates().find((p) => p.id === 'mg').taken).toBe(true);

    // Ticking short of the full delay must not restore it early.
    for (let i = 0; i < 500; i++) system.tick();
    expect(system.getPickupStates().find((p) => p.id === 'mg').taken).toBe(true);

    for (let i = 0; i < 100; i++) system.tick();
    expect(system.getPickupStates().find((p) => p.id === 'mg').taken).toBe(false);
  });

  it('ticks with no entity commands involved at all -- an always-running world-scope loop', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const bot = makeEntity({ id: 'bot0', position: { x: 0, y: 1, z: 0 } });
    system.tryCollect(bot);

    for (let i = 0; i < 600; i++) system.tick();

    expect(system.getPickupStates().find((p) => p.id === 'mg').taken).toBe(false);
    // Available again -- a second entity can now take it.
    const other = makeEntity({ id: 'bot1', position: { x: 0, y: 1, z: 0 } });
    system.tryCollect(other);
    expect(other.heldWeapon).toBe('machinegun');
  });
});

describe('pickups: resetAll restores every pickup and clears pending countdowns (R8)', () => {
  it('a taken pickup with a pending countdown becomes available again immediately', () => {
    const system = createPickupSystem({ pickups: [MG_PICKUP, GRENADE_PICKUP], isLocalPlayer: () => true });
    system.tryCollect(makeEntity({ id: 'bot0', position: { x: 0, y: 1, z: 0 } }));
    system.tryCollect(makeEntity({ id: 'player', position: { x: 10, y: 1, z: 0 } }));
    expect(system.getPickupStates().every((p) => p.taken)).toBe(true);

    system.resetAll();

    expect(system.getPickupStates().every((p) => !p.taken)).toBe(true);
    // No leftover countdown either -- many ticks produce no further change.
    for (let i = 0; i < 700; i++) system.tick();
    expect(system.getPickupStates().every((p) => !p.taken)).toBe(true);
  });
});

describe('pickups: wired into world.step() (AE3, integration)', () => {
  it('a bot walking over the machine-gun spawn holds it, then killing it does not restore the pickup early', () => {
    const rig = buildBotRig({ spawnPoints: [{ x: 0, y: 1, z: 0 }], cooldownTicks: 6 });
    const pickupSystem = createPickupSystem({
      pickups: [MG_PICKUP],
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
    rig.movementSystem.addCharacter('shooter', { x: 0, y: 1, z: -5 });
    world.addEntity('shooter', { position: { x: 0, y: 1, z: -5 } });
    rig.movementSystem.addCharacter('bot0', { x: 0, y: 1, z: 0 });
    world.addEntity('bot0', { position: { x: 0, y: 1, z: 0 } });
    primeBroadPhase(rig);

    const idle = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false } });
    // Forward at yaw 0 is +z (movement.js's convention) -- shooter behind at
    // z=-5 aimed at bot0 at z=0 lands without needing any pitch.
    const fire = createCommand({ yaw: 0, pitch: 0, buttons: { fire: true, fireHeld: false, jump: false, throwGrenade: false } });

    // A single step: bot0 sits on the pickup and takes it.
    world.step(new Map([['bot0', idle]]), 1 / 60);

    expect(world.getEntity('bot0').heldWeapon).toBe('machinegun');
    expect(world.getEntity('bot0').ammo).toBe(MACHINEGUN_MAX_AMMO);
    expect(pickupSystem.getPickupStates()[0].taken).toBe(true);

    // Kill the bot.
    for (let i = 0; i < 60 && !world.getEntity('bot0').dead; i++) {
      world.step(new Map([['shooter', fire], ['bot0', idle]]), 1 / 60);
    }

    expect(world.getEntity('bot0').dead).toBe(true);
    // Death strips the gun (R13) -- but the pickup itself stays taken; its
    // own countdown, started at the original take, is unaffected by the kill.
    expect(world.getEntity('bot0').heldWeapon).toBe('pistol');
    expect(world.getEntity('bot0').ammo).toBeNull();
    expect(pickupSystem.getPickupStates()[0].taken).toBe(true);

    // The countdown restores it on schedule.
    for (let i = 0; i < 600; i++) pickupSystem.tick();
    expect(pickupSystem.getPickupStates()[0].taken).toBe(false);
  });

  it('a dead entity is excluded from collection by world.step\'s own dead-entity guard, before pickups.js is ever reached', () => {
    const pickupSystem = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const world = createWorld({ pickups: pickupSystem });
    world.addEntity('bot0', { position: { x: 0, y: 1, z: 0 } });
    world.getEntity('bot0').dead = true;
    const idle = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false } });

    world.step(new Map([['bot0', idle]]), 1 / 60);

    expect(world.getEntity('bot0').heldWeapon).toBe('pistol');
    expect(pickupSystem.getPickupStates()[0].taken).toBe(false);
  });

  it('a parked/inactive entity with no command in the map at all is never visited -- the real KTD7 mechanism', () => {
    const pickupSystem = createPickupSystem({ pickups: [MG_PICKUP], isLocalPlayer: () => false });
    const world = createWorld({ pickups: pickupSystem });
    // Sitting exactly on the pickup, alive -- but main.js's gatherCommands
    // never puts an inactive/parked bot's id into the commands Map, so
    // world.step's for-of loop simply never iterates it.
    world.addEntity('parkedBot', { position: { x: 0, y: 1, z: 0 } });

    world.step(new Map(), 1 / 60);

    expect(world.getEntity('parkedBot').heldWeapon).toBe('pistol');
    expect(pickupSystem.getPickupStates()[0].taken).toBe(false);
  });
});
