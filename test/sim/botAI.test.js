import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCommand } from '../../src/sim/command.js';
import { createArena } from '../../src/arena/arena.js';
import { ROOMS, DOORWAYS } from '../../src/arena/layout.js';
import { createMovementSystem } from '../../src/sim/movement.js';
import {
  transitionBotState,
  createInitialBotState,
  createBotAI,
  ATTACK_RANGE,
  AWARENESS_RANGE,
  RETREAT_HEALTH_THRESHOLD,
  RETREAT_DURATION_TICKS,
  SEARCH_DWELL_TICKS,
} from '../../src/sim/bot/fsm.js';
import { buildBotRig, addEntity } from '../support/rig.js';

await RAPIER.init();

const PLAYER_POSITION = { x: 3, y: 1, z: 4 }; // an arbitrary fixed sighting point, reused across sensor bundles below

describe('transitionBotState (pure)', () => {
  it('goes idle -> chase once the player is within awareness range and in sight', () => {
    const state = createInitialBotState();
    const next = transitionBotState(
      state,
      { distanceToPlayer: AWARENESS_RANGE - 1, hasLineOfSight: true, health: 100, playerPosition: PLAYER_POSITION },
      1
    );
    expect(next.phase).toBe('chase');
    expect(next.lastSeenPosition).toEqual(PLAYER_POSITION); // KTD3: refreshed while sight holds
  });

  it('covers AE5: stays in patrol when within awareness range but occluded (no line of sight)', () => {
    const state = createInitialBotState();
    const next = transitionBotState(
      state,
      { distanceToPlayer: AWARENESS_RANGE - 1, hasLineOfSight: false, health: 100, playerPosition: PLAYER_POSITION },
      1
    );
    expect(next.phase).toBe('idle');
  });

  it('stays idle when the player is beyond awareness range and out of sight', () => {
    const state = createInitialBotState();
    const next = transitionBotState(
      state,
      { distanceToPlayer: AWARENESS_RANGE + 5, hasLineOfSight: false, health: 100, playerPosition: PLAYER_POSITION },
      1
    );
    expect(next.phase).toBe('idle');
  });

  it('transitions Chase -> Attack once the player enters line of sight within attack range', () => {
    const chasing = { phase: 'chase', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: null };
    const next = transitionBotState(
      chasing,
      { distanceToPlayer: ATTACK_RANGE - 1, hasLineOfSight: true, health: 100, playerPosition: PLAYER_POSITION },
      10
    );
    expect(next.phase).toBe('attack');
    expect(next.lastSeenPosition).toEqual(PLAYER_POSITION);
  });

  it('drops Attack -> Chase when sight or range is lost (existing transition, unchanged)', () => {
    const attacking = { phase: 'attack', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: PLAYER_POSITION };
    const next = transitionBotState(
      attacking,
      { distanceToPlayer: ATTACK_RANGE - 1, hasLineOfSight: false, health: 100, playerPosition: PLAYER_POSITION },
      10
    );
    expect(next.phase).toBe('chase');
  });

  it('drops Attack -> Chase even when both out of range and out of sight (existing transition, unchanged)', () => {
    // Per the plan's phase diagram, attack unconditionally falls back to
    // chase on "sight or range lost" -- it never jumps straight to search
    // or idle itself. Only chase (the very next tick, still unacquired)
    // hands off to search/idle. See the two tests directly below.
    const attacking = { phase: 'attack', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: PLAYER_POSITION };
    const next = transitionBotState(
      attacking,
      { distanceToPlayer: AWARENESS_RANGE + 5, hasLineOfSight: false, health: 100, playerPosition: PLAYER_POSITION },
      10
    );
    expect(next.phase).toBe('chase');
  });

  describe('search (KTD3: honest sensing, AE2)', () => {
    it('drops Chase -> Idle instead of Search when no sighting was ever made (regression)', () => {
      // A bot can reach 'chase' with no lastSeenPosition at all: retreat's
      // exit-to-chase transition (above) is unconditional and health-only,
      // reachable straight from 'idle' -- the hitscan weapon's range exceeds
      // AWARENESS_RANGE, so a bot can take enough damage to retreat without
      // ever having acquired the shooter. Search has nothing to search for
      // in that case; searching a null point crashed navigateToPoint before
      // this guard existed (found by code review, reproduced live).
      const chasingWithNoSighting = { phase: 'chase', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: null };
      const next = transitionBotState(
        chasingWithNoSighting,
        { distanceToPlayer: 999, hasLineOfSight: false, health: 100, playerPosition: { x: 999, y: 1, z: 999 }, searchExhausted: false },
        10
      );
      expect(next.phase).toBe('idle');
      expect(next.lastSeenPosition).toBeNull();
    });

    it('drops Chase -> Search once sight is lost, preserving the last-seen position', () => {
      const chasing = { phase: 'chase', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: PLAYER_POSITION };
      const next = transitionBotState(
        chasing,
        { distanceToPlayer: 5, hasLineOfSight: false, health: 100, playerPosition: { x: 999, y: 1, z: 999 }, searchExhausted: false },
        10
      );
      expect(next.phase).toBe('search');
      // Never overwritten with the (now-hidden) live position -- only ever
      // refreshed by an actual sighting.
      expect(next.lastSeenPosition).toEqual(PLAYER_POSITION);
    });

    it('stays in Search while not yet exhausted', () => {
      const searching = { phase: 'search', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: PLAYER_POSITION };
      const next = transitionBotState(
        searching,
        { distanceToPlayer: 5, hasLineOfSight: false, health: 100, playerPosition: { x: 999, y: 1, z: 999 }, searchExhausted: false },
        50
      );
      expect(next.phase).toBe('search');
      expect(next.lastSeenPosition).toEqual(PLAYER_POSITION);
    });

    it('drops Search -> Chase immediately once sight is reacquired (still outside attack range)', () => {
      const searching = { phase: 'search', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: PLAYER_POSITION };
      const next = transitionBotState(
        searching,
        { distanceToPlayer: ATTACK_RANGE + 5, hasLineOfSight: true, health: 100, playerPosition: PLAYER_POSITION, searchExhausted: false },
        50
      );
      expect(next.phase).toBe('chase');
    });

    it('drops Search -> Attack directly once sight is reacquired within attack range', () => {
      // Same "acquired + already in range -> attack directly" shortcut
      // patrol/idle already gets on its first acquisition tick -- whichever
      // phase search is left from, close enough is close enough.
      const searching = { phase: 'search', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: PLAYER_POSITION };
      const next = transitionBotState(
        searching,
        { distanceToPlayer: ATTACK_RANGE - 1, hasLineOfSight: true, health: 100, playerPosition: PLAYER_POSITION, searchExhausted: false },
        50
      );
      expect(next.phase).toBe('attack');
    });

    it('drops Search -> Idle (patrol) once exhausted, clearing the last-seen position', () => {
      const searching = { phase: 'search', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: PLAYER_POSITION };
      const next = transitionBotState(
        searching,
        { distanceToPlayer: 5, hasLineOfSight: false, health: 100, playerPosition: { x: 999, y: 1, z: 999 }, searchExhausted: true },
        200
      );
      expect(next.phase).toBe('idle');
      expect(next.lastSeenPosition).toBeNull();
    });
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

    it('exits retreat immediately once health is back to full, without waiting out the timer (regression)', () => {
      // Regression: gatherCommands (main.js) gives a dead bot no command at
      // all, so the AI's internal tick freezes while dead -- but
      // retreatEndTick is an absolute tick value. A bot that died mid-retreat
      // and respawned at full health previously kept serving the entire
      // unspent retreat window post-respawn, fleeing at full health for no
      // reason. A respawned-at-full-health bot has no reason to keep
      // fleeing: this game has no health regen, so health this high while
      // still in retreat uniquely means "just respawned."
      const state = { phase: 'retreat', retreatArmed: false, retreatEndTick: 100_000 }; // far-future end
      const next = transitionBotState(state, { distanceToPlayer: 5, hasLineOfSight: true, health: 100 }, 110);
      expect(next.phase).not.toBe('retreat');
    });

    it('trusts the armed latch over a direct health check (documented invariant)', () => {
      // transitionBotState is the only producer of bot AI state, and it
      // always keeps retreatArmed in sync with health (the ternary at the
      // top of this function) -- so {phase:'retreat', retreatArmed:true}
      // with health still low is a state no real call sequence can
      // produce. This pins that as a deliberate trust boundary, not an
      // untested gap: given such a (synthetic, invariant-violating) state,
      // the retreat-continuation guard trusts the latch and exits to
      // chase, rather than re-deriving health independently.
      const invariantViolatingState = { phase: 'retreat', retreatArmed: true, retreatEndTick: 500 };
      const next = transitionBotState(
        invariantViolatingState,
        { distanceToPlayer: 5, hasLineOfSight: true, health: 10 },
        100
      );
      expect(next.phase).toBe('chase');
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
    const rig = buildBotRig();
    addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
    rig.movementSystem.commit();

    const bot = createBotAI({ rapierWorld: rig.rapierWorld, movementSystem: rig.movementSystem, botId: 'bot', random: () => 0.5 });
    const player = { x: 0, y: 1, z: ATTACK_RANGE - 2 }; // start already in range+LOS
    let firedAtLeastOnce = false;

    for (let i = 0; i < 120; i++) {
      const botPosition = rig.world.getEntity('bot').position;
      const command = bot.sample(botPosition, player, 100);
      if (command.buttons.fire) firedAtLeastOnce = true;
      rig.world.step(new Map([['bot', command]]), 1 / 60);
    }

    const finalDistance = Math.hypot(
      player.x - rig.world.getEntity('bot').position.x,
      player.z - rig.world.getEntity('bot').position.z
    );
    expect(finalDistance).toBeLessThan(ATTACK_RANGE);
    expect(firedAtLeastOnce).toBe(true);
    expect(bot.getPhase()).toBe('attack');
  });
});

describe('createBotAI: line of sight gates firing', () => {
  it('does not fire when cover fully blocks line of sight to the player', () => {
    const rig = buildBotRig({ obstacles: [{ x: 0, y: 1, z: 5, hx: 2, hy: 2, hz: 0.5 }] });
    rig.movementSystem.addCharacter('bot', { x: 0, y: 1, z: 0 });
    rig.movementSystem.commit();

    const bot = createBotAI({ rapierWorld: rig.rapierWorld, movementSystem: rig.movementSystem, botId: 'bot', random: () => 0.5 });
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
    // Two separate rigs, not two bots sharing one world at the same spot:
    // an R13 acquisition gate reads a same-position spawn as each bot
    // blocking the other's line-of-sight ray at its own collider surface,
    // which would spuriously read as "never acquires" for both. Separate
    // worlds keep the geometry identical for both bots (same relative
    // position to the player) with zero risk of cross-bot interference.
    function sampleYaw(aimSpread) {
      const rig = buildBotRig();
      rig.movementSystem.addCharacter('bot', { x: 0, y: 1, z: 0 });
      rig.movementSystem.commit();
      const bot = createBotAI({
        rapierWorld: rig.rapierWorld,
        movementSystem: rig.movementSystem,
        botId: 'bot',
        difficulty: { aimSpread, reactionDelayTicks: 0 },
        random: () => 1, // worst-case jitter roll
      });
      const player = { x: 0, y: 1, z: ATTACK_RANGE - 2 }; // definitely in range+LOS, survives a future retune
      const command = bot.sample({ x: 0, y: 1, z: 0 }, player, 100);
      expect(bot.getPhase()).toBe('attack');
      return command.yaw;
    }

    expect(Math.abs(sampleYaw(0.8) - sampleYaw(0))).toBeGreaterThan(0.3);
  });

  it('higher reaction delay postpones the first shot after entering attack range', () => {
    // reactionDelayTicks gates the *first* shot of a fresh attack episode
    // independently of the fire-interval cadence (a bot that already spent
    // time chasing enters attack with its fire timer partly elapsed) -- so
    // to see reaction delay's effect distinctly, use a value clearly past
    // FIRE_INTERVAL_TICKS (45); a smaller value would be masked by it.
    function ticksUntilFirstShot(reactionDelayTicks) {
      const rig = buildBotRig();
      rig.movementSystem.addCharacter('bot', { x: 0, y: 1, z: 0 });
      rig.movementSystem.commit();

      const bot = createBotAI({
        rapierWorld: rig.rapierWorld,
        movementSystem: rig.movementSystem,
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

  it('zero aim spread reliably hits a stationary target; wide spread reliably misses it (accuracy drop)', () => {
    // The yaw-variance test above proves the jitter arithmetic composes
    // correctly, but not that it actually changes whether shots land --
    // the deleted U6 bot.test.js proved that end-to-end (a wide-spread shot
    // left the target at full, unhit, health) and this replacement lost
    // that assertion. Restoring it through the real weapon/health pipeline,
    // matching the U11 test-scenario requirement: "Given high aim-spread
    // settings, Then bot accuracy measurably drops."
    function fireAndMeasureTargetHealth(aimSpread) {
      const rig = buildBotRig();
      addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
      addEntity(rig, 'target', { x: 0, y: 1, z: ATTACK_RANGE - 2 }); // dead ahead, in range+LOS from tick 1
      rig.movementSystem.commit();

      const bot = createBotAI({
        rapierWorld: rig.rapierWorld,
        movementSystem: rig.movementSystem,
        botId: 'bot',
        difficulty: { aimSpread, reactionDelayTicks: 0 },
        random: () => 1, // worst-case jitter roll, matching the sibling test above
      });

      for (let i = 0; i < 120; i++) {
        const botPosition = rig.world.getEntity('bot').position;
        const targetPosition = rig.world.getEntity('target').position;
        const command = bot.sample(botPosition, targetPosition, 100);
        rig.world.step(new Map([['bot', command], ['target', createCommand()]]), 1 / 60);
      }

      return rig.world.getEntity('target').health;
    }

    expect(fireAndMeasureTargetHealth(0)).toBeLessThan(100); // no spread: direct line, hits
    expect(fireAndMeasureTargetHealth(0.8)).toBe(100); // wide spread: deviates well past the target
  });
});

describe('createBotAI: patrol crosses doorways without sticking (AE1, R7)', () => {
  it('a bot with no target crosses at least one doorway within 20 sim-seconds, with no sustained stuck run', () => {
    const arena = createArena();
    const movementSystem = createMovementSystem(arena.rapierWorld);
    const nw = ROOMS.find((r) => r.id === 'nw');
    // A real spawn point, not the room's raw geometric centre -- nw's
    // centre is where layout.js puts its landmark pillar, so starting a
    // capsule exactly there would embed it in solid geometry, which no
    // real spawn point ever does (test/arena/layout.test.js covers that).
    const startPosition = arena.spawnPoints.find((p) => Math.abs(p.x - nw.x) <= nw.halfX && Math.abs(p.z - nw.z) <= nw.halfZ);
    movementSystem.addCharacter('bot', startPosition);
    movementSystem.commit();

    const bot = createBotAI({ rapierWorld: arena.rapierWorld, movementSystem, botId: 'bot' });
    // Far outside the map on every axis: the map's outer walls fully
    // enclose the interior (test/arena/layout.test.js's AE4 coverage), so
    // no in-map position can ever have line of sight out to this point, and
    // the XZ distance to it is always far past AWARENESS_RANGE regardless
    // of where patrol takes the bot -- unlike a plausible in-map point,
    // this guarantees idle/patrol for the whole run instead of the bot
    // occasionally noticing "the player" and switching to chase.
    const player = { x: 1000, y: 1, z: 1000 };
    const entity = { id: 'bot', position: { ...startPosition } };

    let stuckTicks = 0;
    let maxConsecutiveStuck = 0;
    let everLeftPhaseIdle = false;
    let leftStartingRoom = false;
    const TICKS = 20 * 60; // 20 sim-seconds at 60Hz

    for (let i = 0; i < TICKS; i++) {
      const before = { x: entity.position.x, z: entity.position.z };
      const command = bot.sample(entity.position, player, 100);
      if (bot.getPhase() !== 'idle') everLeftPhaseIdle = true;
      movementSystem.resolveMovement(entity, command, 1 / 60);
      movementSystem.commit();

      const displacement = Math.hypot(entity.position.x - before.x, entity.position.z - before.z);
      stuckTicks = displacement < 0.005 ? stuckTicks + 1 : 0;
      maxConsecutiveStuck = Math.max(maxConsecutiveStuck, stuckTicks);

      if (Math.abs(entity.position.x - nw.x) > nw.halfX || Math.abs(entity.position.z - nw.z) > nw.halfZ) {
        leftStartingRoom = true;
      }
    }

    expect(everLeftPhaseIdle).toBe(false);
    expect(leftStartingRoom).toBe(true); // crossed at least one doorway
    expect(maxConsecutiveStuck).toBeLessThan(60); // never frozen for a full second
  });
});

describe('createBotAI: search (AE2, KTD3)', () => {
  it('sight broken mid-chase steers to the frozen last-seen point, never the live hidden position, then gives up to patrol', () => {
    // The real arena, not a synthetic rig: navigateToPoint routes through
    // the shipped waypoint graph's real room/doorway nodes regardless of
    // the physics world it's driving, so a synthetic rig whose geometry
    // doesn't correspond to that graph produces an unpredictable route.
    // SE has no landmark pillar (layout.js), so standing at its exact
    // centre is safe. SW is a different, wall-separated room (AE4 already
    // covers this pair's occlusion) -- an unambiguous "vanished" spot.
    const arena = createArena();
    const movementSystem = createMovementSystem(arena.rapierWorld);
    const se = ROOMS.find((r) => r.id === 'se');
    const sw = ROOMS.find((r) => r.id === 'sw');
    const startPosition = { x: se.x, y: 1, z: se.z };
    movementSystem.addCharacter('bot', startPosition);
    movementSystem.commit();
    const bot = createBotAI({ rapierWorld: arena.rapierWorld, movementSystem, botId: 'bot' });
    const entity = { id: 'bot', position: { ...startPosition } };

    const lastVisiblePosition = { x: se.x + 2, y: 1, z: se.z + 2 }; // a few units away, same room -- clear sight
    const hiddenPosition = { x: sw.x, y: 1, z: sw.z }; // a different, wall-separated room

    // Phase 1: player visible nearby in the same room.
    for (let i = 0; i < 5; i++) {
      const command = bot.sample(entity.position, lastVisiblePosition, 100);
      movementSystem.resolveMovement(entity, command, 1 / 60);
      movementSystem.commit();
    }
    expect(['attack', 'chase']).toContain(bot.getPhase());

    // Phase 2: player vanishes into a different room -- sight breaks.
    let reachedSearch = false;
    let neverCloserToHiddenThanLastSeen = true;
    let ticksInSearch = 0;
    const MAX_TICKS = 20 * 60; // 20 sim-seconds -- generous for a same-room search point
    for (let i = 0; i < MAX_TICKS; i++) {
      const command = bot.sample(entity.position, hiddenPosition, 100);
      if (bot.getPhase() === 'search') {
        reachedSearch = true;
        ticksInSearch += 1;
        const distanceToLastSeen = Math.hypot(entity.position.x - lastVisiblePosition.x, entity.position.z - lastVisiblePosition.z);
        const distanceToHidden = Math.hypot(entity.position.x - hiddenPosition.x, entity.position.z - hiddenPosition.z);
        if (distanceToHidden < distanceToLastSeen) neverCloserToHiddenThanLastSeen = false;
      }
      movementSystem.resolveMovement(entity, command, 1 / 60);
      movementSystem.commit();
      if (reachedSearch && bot.getPhase() === 'idle') break; // gave up -- done
    }

    expect(reachedSearch).toBe(true);
    expect(neverCloserToHiddenThanLastSeen).toBe(true); // never chased the live hidden position
    expect(ticksInSearch).toBeGreaterThanOrEqual(SEARCH_DWELL_TICKS); // actually dwelled, didn't just pass through
    expect(bot.getPhase()).toBe('idle'); // gave up to patrol
  });

  it('faces the frozen last-seen point while dwelling, not the live hidden position (regression)', () => {
    // The dwell branch used to set yaw from facingYaw, which tracks the
    // live player position every tick regardless of phase -- visibly
    // "staring" the bot through the wall at the still-hidden player for
    // the whole dwell window (found by code review). Once arrived, yaw
    // must stay fixed on the last-seen point even though the (still
    // occluded) hidden position keeps being fed in every tick.
    const arena = createArena();
    const movementSystem = createMovementSystem(arena.rapierWorld);
    const se = ROOMS.find((r) => r.id === 'se');
    const sw = ROOMS.find((r) => r.id === 'sw');
    const startPosition = { x: se.x, y: 1, z: se.z };
    movementSystem.addCharacter('bot', startPosition);
    movementSystem.commit();
    const bot = createBotAI({ rapierWorld: arena.rapierWorld, movementSystem, botId: 'bot' });
    const entity = { id: 'bot', position: { ...startPosition } };
    const lastVisiblePosition = { x: se.x + 2, y: 1, z: se.z + 2 };
    const hiddenPosition = { x: sw.x, y: 1, z: sw.z };

    for (let i = 0; i < 5; i++) {
      const command = bot.sample(entity.position, lastVisiblePosition, 100);
      movementSystem.resolveMovement(entity, command, 1 / 60);
      movementSystem.commit();
    }

    let arrived = false;
    let yawWhileDwelling = null;
    for (let i = 0; i < 60 && !arrived; i++) {
      const command = bot.sample(entity.position, hiddenPosition, 100);
      movementSystem.resolveMovement(entity, command, 1 / 60);
      movementSystem.commit();
      const distanceToLastSeen = Math.hypot(entity.position.x - lastVisiblePosition.x, entity.position.z - lastVisiblePosition.z);
      if (bot.getPhase() === 'search' && distanceToLastSeen < 1.6) {
        arrived = true;
        yawWhileDwelling = command.yaw;
      }
    }
    expect(arrived).toBe(true);

    const bearingToHiddenPosition = Math.atan2(hiddenPosition.x - entity.position.x, hiddenPosition.z - entity.position.z);
    expect(Math.abs(yawWhileDwelling - bearingToHiddenPosition)).toBeGreaterThan(1); // not facing the live hidden position
  });
});

describe('createBotAI: search timer counts sim ticks only', () => {
  it('the dwell window elapses strictly by counted sample() calls, never by wall-clock time', () => {
    // Bot and "visible" player both at SE room's exact centre (no landmark
    // pillar there, so this is a real, standable point) -- lastSeenPosition
    // becomes exactly that point, and the nearest graph node to it is the
    // room itself, so search's path is trivially already "arrived" on the
    // first tick. Isolates the dwell-count logic from travel time.
    const arena = createArena();
    const movementSystem = createMovementSystem(arena.rapierWorld);
    const se = ROOMS.find((r) => r.id === 'se');
    const position = { x: se.x, y: 1, z: se.z };
    movementSystem.addCharacter('bot', position);
    movementSystem.commit();
    const bot = createBotAI({ rapierWorld: arena.rapierWorld, movementSystem, botId: 'bot' });

    bot.sample(position, position, 100); // distance 0 -- straight to attack
    expect(bot.getPhase()).toBe('attack');
    // Hidden far below the floor -- distance alone keeps it unacquired
    // (R13 also requires sight, which this trivially also lacks).
    const hidden = { x: se.x, y: -500, z: se.z };
    bot.sample(position, hidden, 100); // attack -> chase (existing transition)
    bot.sample(position, hidden, 100); // chase -> search
    expect(bot.getPhase()).toBe('search');

    for (let i = 0; i < SEARCH_DWELL_TICKS / 2; i++) bot.sample(position, hidden, 100);
    expect(bot.getPhase()).toBe('search'); // well under the window -- still searching

    // Stop as soon as it leaves search: once patrol takes over, its own
    // navigator expects the bot to actually be moving tick to tick -- this
    // test holds position frozen throughout (isolating the dwell count from
    // travel time), which patrol would otherwise read as stuck against
    // nothing and repeatedly repath, a test artifact unrelated to what this
    // test checks.
    let ticksToExit = 0;
    while (bot.getPhase() === 'search' && ticksToExit < SEARCH_DWELL_TICKS * 2) {
      bot.sample(position, hidden, 100);
      ticksToExit += 1;
    }
    expect(bot.getPhase()).toBe('idle'); // gave up strictly within the expected tick budget
  });
});

describe('createBotAI: search survives death and match reset (KTD5)', () => {
  it('a bot that dies mid-search respawns into patrol with no target memory (regression)', () => {
    const rig = buildBotRig({ obstacles: [{ x: 0, y: 1, z: 7, hx: 20, hy: 2, hz: 0.5 }] });
    addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
    rig.movementSystem.commit();
    const bot = createBotAI({ rapierWorld: rig.rapierWorld, movementSystem: rig.movementSystem, botId: 'bot' });

    bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 4 }, 100); // visible -- acquires (attack)
    bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 50); // hidden -- attack -> chase (existing transition); also takes damage, irrelevant here
    bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 50); // still hidden -- chase -> search
    expect(bot.getPhase()).toBe('search');

    // Death: gatherCommands (main.js) simply stops calling sample() for a
    // dead entity -- nothing to simulate here except the gap itself. The
    // next call is the respawn tick: health jumps back to 100 (this game's
    // only source of a health increase), the one signal available to infer
    // "just respawned" without main.js threading an explicit flag through.
    const commandAfterRespawn = bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 100);

    expect(bot.getPhase()).toBe('idle'); // not still "searching" a stale point
    // No lingering search-target intent: yaw is plain patrol-seek toward a
    // graph subgoal, not still oriented at the old last-seen point behind
    // the wall (z=4), which sat almost directly ahead (yaw ~= 0).
    expect(Math.abs(commandAfterRespawn.yaw)).toBeGreaterThan(0.01);
  });

  it('a match reset mid-search reinitializes the bot AI for the next match (regression)', () => {
    const rig = buildBotRig({ obstacles: [{ x: 0, y: 1, z: 7, hx: 20, hy: 2, hz: 0.5 }] });
    addEntity(rig, 'bot', { x: 0, y: 1, z: 0 });
    rig.movementSystem.commit();
    const bot = createBotAI({ rapierWorld: rig.rapierWorld, movementSystem: rig.movementSystem, botId: 'bot' });

    bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 4 }, 100); // visible -- attack
    bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 100); // hidden -- attack -> chase
    bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 100); // still hidden -- chase -> search
    expect(bot.getPhase()).toBe('search');

    bot.reset(); // main.js's onRestart calls this for every bot

    expect(bot.getPhase()).toBe('idle');
    // A fresh match start: even immediately re-seeing the same player at
    // the same spot must read as a brand-new acquisition, not a resumed
    // search -- next tick lands in chase/attack same as any first sighting.
    bot.sample({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 4 }, 100);
    expect(['attack', 'chase']).toContain(bot.getPhase());
  });
});

describe('createBotAI: retreat routes through a doorway (R9)', () => {
  it("targets the room's doorway farthest from the attacker, not a bare away-vector into a solid wall", () => {
    const arena = createArena();
    const movementSystem = createMovementSystem(arena.rapierWorld);
    const nw = ROOMS.find((r) => r.id === 'nw');
    const nwTop = DOORWAYS.find((d) => d.id === 'nw-top'); // NW's east doorway, (-18, 26)
    const nwLeft = DOORWAYS.find((d) => d.id === 'nw-left'); // NW's south doorway, (-26, 18)

    // Bot inside NW, clear of the room's landmark pillar (centred at the
    // room's own centre). Attacker due south -- a bare "flee straight away
    // from the attacker" vector points due north, straight into NW's solid
    // north wall (layout.js has no doorway there). The farther doorway by
    // actual distance is nw-top (east), not nw-left (south, closer to the
    // attacker) -- so a doorway-aware retreat must head east, not north.
    const startPosition = { x: nw.x + 4, y: 1, z: nw.z };
    const attacker = { x: nw.x + 4, y: 1, z: nw.z - 16 };
    expect(Math.hypot(nwTop.x - attacker.x, nwTop.z - attacker.z)).toBeGreaterThan(
      Math.hypot(nwLeft.x - attacker.x, nwLeft.z - attacker.z)
    );

    movementSystem.addCharacter('bot', startPosition);
    movementSystem.commit();
    const bot = createBotAI({ rapierWorld: arena.rapierWorld, movementSystem, botId: 'bot' });
    const entity = { id: 'bot', position: { ...startPosition } };

    // Force retreat immediately: low health, attacker in sight and close.
    let command = bot.sample(entity.position, attacker, RETREAT_HEALTH_THRESHOLD - 1);
    expect(bot.getPhase()).toBe('retreat');

    for (let i = 0; i < 90; i++) {
      command = bot.sample(entity.position, attacker, RETREAT_HEALTH_THRESHOLD - 1);
      movementSystem.resolveMovement(entity, command, 1 / 60);
      movementSystem.commit();
    }

    expect(entity.position.z).toBeLessThan(startPosition.z + 8); // nowhere near the solid north wall (z=34)
    expect(entity.position.x).toBeGreaterThan(startPosition.x); // moved east, toward nw-top
  });

  it('survives retreat -> timer expiry while still unacquired without crashing (regression)', () => {
    // The hitscan weapon's range exceeds AWARENESS_RANGE, so a bot can be
    // damaged into retreat by an attacker it has never actually sensed.
    // Retreat's timer-expiry exit to 'chase' is unconditional; if the bot is
    // still unacquired when it fires, chase must not fall through to search
    // a null last-seen point (that crashed navigateToPoint before the fix).
    const arena = createArena();
    const movementSystem = createMovementSystem(arena.rapierWorld);
    const nw = ROOMS.find((r) => r.id === 'nw');
    const startPosition = arena.spawnPoints.find((p) => Math.abs(p.x - nw.x) <= nw.halfX && Math.abs(p.z - nw.z) <= nw.halfZ);
    movementSystem.addCharacter('bot', startPosition);
    movementSystem.commit();
    const bot = createBotAI({ rapierWorld: arena.rapierWorld, movementSystem, botId: 'bot' });
    const entity = { id: 'bot', position: { ...startPosition } };

    // Far beyond AWARENESS_RANGE and never in sight -- the bot never acquires.
    const distantAttacker = { x: startPosition.x, y: 1, z: startPosition.z + AWARENESS_RANGE + 20 };

    expect(() => {
      let command = bot.sample(entity.position, distantAttacker, RETREAT_HEALTH_THRESHOLD - 1);
      expect(bot.getPhase()).toBe('retreat');
      for (let i = 0; i < RETREAT_DURATION_TICKS + 60; i++) {
        command = bot.sample(entity.position, distantAttacker, RETREAT_HEALTH_THRESHOLD - 1);
        movementSystem.resolveMovement(entity, command, 1 / 60);
        movementSystem.commit();
      }
    }).not.toThrow();
    expect(bot.getPhase()).toBe('idle'); // gives up to patrol -- nothing to search for
  });
});
