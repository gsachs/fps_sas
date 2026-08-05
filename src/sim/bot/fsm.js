// Bot decision-making (KTD4): Idle/Patrol -> Chase -> Attack -> Search ->
// Retreat, sensed via distance plus a line-of-sight raycast against the sim
// world. Acquisition is line-of-sight gated (R13): occluded proximity alone
// never starts or holds a chase, so a target lost mid-chase drops to Search
// (KTD3) -- hunting the last-seen position, not a live occluded one.
// transitionBotState is a pure reducer (mirrors shell/states.js's
// transition() shape, but over a continuous sensor bundle rather than a
// discrete event, so it owns its own distance/health thresholds rather than
// deferring to difficulty.js's per-bot tunables). createBotAI is the
// stateful wrapper that senses, decides, steers, and emits a Command --
// still the same shape the player emits (KTD2).
import { createCommand, createFireLatch } from '../command.js';
import { hasLineOfSight as checkLineOfSight } from '../lineOfSight.js';
import { seek, avoidObstacles } from './steering.js';
import { DEFAULT_DIFFICULTY } from './difficulty.js';
import { isHeldFireWeapon } from '../weapon.js';
import { createNavigator, createPatrolPicker, nearestNodeId, GRAPH, ROOM_IDS } from './navigation.js';
import { ROOMS, DOORWAYS } from '../../arena/layout.js';

// Sized against the old open-box arena's scale (a ~60x60 floor with spawn
// points up to ~55 units apart) -- these were first written smaller, before
// that resize, and left bots unable to ever notice or engage the player
// across a realistic spawn separation (caught by live play, not by unit
// tests using close-together synthetic positions). The rooms-and-corridors
// map (src/arena/layout.js) is a different scale and shape entirely, and
// this is a U6 retuning surface: live play, not a computed guess, decides
// the new values (this codebase has miscalibrated ranges against synthetic
// assumptions before -- see the paragraph above). Verified reference
// geometry for that session: corner rooms are 16x16 (diagonal ~22.6),
// the central room is 20x20 (diagonal ~28.3), a loop corridor run is ~36
// units end to end, and a spoke into the centre is ~14.5 units -- so most
// occluded-free sightlines top out well under AWARENESS_RANGE's current 50,
// and ATTACK_RANGE's current 25 already exceeds most single-room diagonals.
export const ATTACK_RANGE = 25;
export const AWARENESS_RANGE = 50;
export const RETREAT_HEALTH_THRESHOLD = 30;
export const RETREAT_DURATION_TICKS = 180; // ~3s at 60Hz
// How long a bot holds at a last-seen point before giving up (GameAI Pro's
// "brief pursuit on intuition, then search, then give up," simplified to
// one search spot for v1). Tick-denominated per KTD5, like retreat's window.
export const SEARCH_DWELL_TICKS = 90; // ~1.5s at 60Hz
const MOVE_DEADZONE = 1.5; // stop closing once this close, so bots don't shove into the player
const FIRE_INTERVAL_TICKS = 45; // intent to fire ~1.3x/sec; weapon.js's cooldown still bounds actual rate

function nearestRoomId(position) {
  let bestId = null;
  let bestDistance = Infinity;
  for (const room of ROOMS) {
    const distance = Math.hypot(room.x - position.x, room.z - position.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = room.id;
    }
  }
  return bestId;
}

// R9: retreat targets a doorway, not a bare away-vector -- specifically the
// current room's exit farthest from the attacker, so fleeing routes toward
// cover instead of into whichever wall happens to be directly behind the bot.
function farthestDoorway(roomId, awayFromPosition) {
  const roomDoorways = DOORWAYS.filter((d) => d.connects.includes(roomId));
  let best = roomDoorways[0];
  let bestDistance = -Infinity;
  for (const doorway of roomDoorways) {
    const distance = Math.hypot(doorway.x - awayFromPosition.x, doorway.z - awayFromPosition.z);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = doorway;
    }
  }
  return best;
}

// Once a fleeing bot reaches its chosen doorway, continue one hop further
// (any other node the doorway connects to) so it actually passes through
// into the space beyond and breaks line of sight, rather than stopping and
// standing in the open threshold it just reached.
function continuationTarget(doorwayId, avoidNodeId) {
  for (const neighborId of GRAPH.edges.get(doorwayId).keys()) {
    if (neighborId !== avoidNodeId) return neighborId;
  }
  return avoidNodeId; // no alternative -- R3 guarantees this doesn't happen on the shipped map
}

export function createInitialBotState() {
  return { phase: 'idle', retreatArmed: true, retreatEndTick: 0, lastSeenPosition: null };
}

// Pure: given the bot's current state, this tick's sensor readings, and the
// current tick number, returns the next state. No Rapier, no randomness, no
// I/O -- directly unit-testable.
//
// Retreat uses an arm/disarm latch, not a plain health threshold: this game
// has no health regen (only a full heal on respawn), so a naive "health <
// threshold -> retreat" guard would re-fire every tick the instant a timed
// retreat expired, since health never recovers to clear the guard. Retreat
// only re-arms once health rises again (i.e., after a respawn).
export function transitionBotState(state, sensors, tick) {
  const { distanceToPlayer, hasLineOfSight, health, playerPosition, searchExhausted } = sensors;
  const armed = health >= RETREAT_HEALTH_THRESHOLD ? true : state.retreatArmed;

  if (armed && health < RETREAT_HEALTH_THRESHOLD && state.phase !== 'retreat') {
    return { ...state, phase: 'retreat', retreatArmed: false, retreatEndTick: tick + RETREAT_DURATION_TICKS };
  }
  if (state.phase === 'retreat') {
    // Stay in retreat only while still unarmed (health hasn't recovered)
    // and the timer hasn't run out. `armed` already means "health is back
    // at or above the threshold" (per the ternary above), so this reuses
    // that latch instead of re-testing health -- and, since this game has
    // no health regen (only a full heal on respawn), armed-while-retreating
    // uniquely means "just respawned": exit immediately rather than
    // serving out a retreat window budgeted for the bot that died, not the
    // fresh one that just spawned in. Without this, a bot that died
    // mid-retreat resumed fleeing at full health for however much of the
    // window remained (gatherCommands gives a dead bot no command, so this
    // reducer isn't called and `tick` doesn't advance while dead, but
    // retreatEndTick is an absolute tick value).
    if (!armed && tick < state.retreatEndTick) {
      return { ...state, phase: 'retreat', retreatArmed: armed, retreatEndTick: state.retreatEndTick };
    }
    return { ...state, phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
  }

  // R13: acquisition is line-of-sight gated -- occluded proximity alone
  // (AE5) never starts or continues a chase.
  const acquired = hasLineOfSight && distanceToPlayer <= AWARENESS_RANGE;

  if (acquired && distanceToPlayer <= ATTACK_RANGE) {
    return { ...state, phase: 'attack', retreatArmed: armed, retreatEndTick: 0, lastSeenPosition: playerPosition };
  }
  if (acquired) {
    return { ...state, phase: 'chase', retreatArmed: armed, retreatEndTick: 0, lastSeenPosition: playerPosition };
  }
  if (state.phase === 'attack') {
    // "sight or range lost" -- existing transition, unchanged (KTD3's
    // honest-sensing rework only adds the chase -> search edge below).
    return { ...state, phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
  }
  if (state.phase === 'chase' && state.lastSeenPosition) {
    // Honest sensing (KTD3): hunt where the target *was*, never steer at a
    // live occluded position. lastSeenPosition already holds the last
    // acquired sighting (set above, on whichever earlier tick still had
    // sight) -- search steers at that frozen point.
    return { ...state, phase: 'search', retreatArmed: armed, retreatEndTick: 0 };
  }
  if (state.phase === 'chase') {
    // Reached chase with no sighting ever made -- e.g. retreat's
    // unconditional exit-to-chase above, entered straight from idle by a
    // health-only trigger (the hitscan weapon's range exceeds
    // AWARENESS_RANGE, so a bot can take enough damage to retreat without
    // ever having acquired the shooter). There is nothing to search for;
    // searching a null point would crash navigateToPoint (Core Invariant:
    // never pass null) -- fall back to patrol instead.
    return { ...state, phase: 'idle', retreatArmed: armed, retreatEndTick: 0 };
  }
  if (state.phase === 'search') {
    if (searchExhausted) {
      return { ...state, phase: 'idle', retreatArmed: armed, retreatEndTick: 0, lastSeenPosition: null };
    }
    return { ...state, phase: 'search', retreatArmed: armed, retreatEndTick: 0 };
  }
  return { ...state, phase: 'idle', retreatArmed: armed, retreatEndTick: 0 };
}

export function createBotAI({ rapierWorld, movementSystem, botId, difficulty = DEFAULT_DIFFICULTY, random = Math.random }) {
  const fireLatch = createFireLatch();
  const excludeCollider = movementSystem.getCollider(botId);
  const navigator = createNavigator();
  const patrolPicker = createPatrolPicker(ROOM_IDS);
  let state = createInitialBotState();
  let tick = 0;
  let ticksSinceEnteredAttack = 0;
  let ticksSinceFire = 0;
  let previousHealth = 100;
  let searchDwellStartTick = null;
  let retreatOriginRoomId = null;
  let retreatDoorwayId = null;
  let retreatContinued = false;

  // KTD5: a Search dwell deadline is an absolute-tick budget, structurally
  // identical to the bugged retreat deadline -- a bot that dies mid-search
  // must not resume searching a stale point post-respawn. This game has no
  // health regen (only a full heal on respawn), so a health increase since
  // the last sample() call unambiguously means "just respawned," the same
  // invariant transitionBotState's retreat latch already relies on.
  function clearTargetMemory() {
    state = createInitialBotState();
    navigator.reset();
    searchDwellStartTick = null;
  }

  // Full reinitialization for a fresh match (KTD5), not just target memory.
  function reset() {
    clearTargetMemory();
    tick = 0;
    ticksSinceEnteredAttack = 0;
    ticksSinceFire = 0;
    previousHealth = 100;
    retreatOriginRoomId = null;
    retreatDoorwayId = null;
    retreatContinued = false;
  }

  function sample(botPosition, playerPosition, botHealth, heldWeapon = 'pistol') {
    if (botHealth > previousHealth) clearTargetMemory();
    previousHealth = botHealth;
    tick += 1;
    const dx = playerPosition.x - botPosition.x;
    const dz = playerPosition.z - botPosition.z;
    const distanceToPlayer = Math.hypot(dx, dz);
    const facingYaw = Math.atan2(dx, dz);
    const hasLineOfSight = checkLineOfSight(rapierWorld, botPosition, playerPosition, excludeCollider);

    // Advances (but does not yet consume) last tick's search dwell status --
    // mirrors hasLineOfSight: computed before the pure reducer runs and fed
    // in as a sensor, not decided by the reducer itself. A pure isDone()
    // read (no navigator.tick() call) avoids double-advancing the search
    // path in the same tick this dwell timer starts.
    if (state.phase === 'search' && navigator.isDone() && searchDwellStartTick === null) {
      searchDwellStartTick = tick;
    }
    const searchExhausted =
      state.phase === 'search' && searchDwellStartTick !== null && tick - searchDwellStartTick >= SEARCH_DWELL_TICKS;

    const previousPhase = state.phase;
    state = transitionBotState(
      state,
      { distanceToPlayer, hasLineOfSight, health: botHealth, playerPosition, searchExhausted },
      tick
    );
    if (state.phase === 'attack') {
      ticksSinceEnteredAttack = previousPhase === 'attack' ? ticksSinceEnteredAttack + 1 : 0;
    }
    if (previousPhase !== 'search' && state.phase === 'search') {
      navigator.navigateToPoint(state.lastSeenPosition, botPosition);
      searchDwellStartTick = null;
    } else if (previousPhase === 'search' && state.phase !== 'search') {
      searchDwellStartTick = null; // reacquired, or gave up -- either way, done dwelling
    }

    let moveDirection;
    let yaw;
    if (state.phase === 'retreat') {
      // Flee toward the current room's exit farthest from the attacker
      // (R9), regardless of sight -- timer-expiry semantics (transitionBotState)
      // are unchanged; only how retreat steers changes.
      if (previousPhase !== 'retreat') {
        retreatOriginRoomId = nearestRoomId(botPosition);
        const doorway = farthestDoorway(retreatOriginRoomId, playerPosition);
        retreatDoorwayId = doorway.id;
        retreatContinued = false;
        navigator.navigateTo(retreatDoorwayId, botPosition);
      } else if (!retreatContinued && navigator.isDone()) {
        // Reached the doorway -- continue through it into the space beyond
        // so the bot actually breaks line of sight (F3), not just stands
        // in the open threshold it just arrived at.
        retreatContinued = true;
        navigator.navigateTo(continuationTarget(retreatDoorwayId, retreatOriginRoomId), botPosition);
      }
      const { subgoalPosition } = navigator.tick(botPosition);
      moveDirection = seek(botPosition, subgoalPosition);
      yaw = Math.atan2(moveDirection.x, moveDirection.z);
    } else if (state.phase === 'idle') {
      // No target: patrol between rooms via the waypoint graph (R7) rather
      // than idling in place. Picks a fresh least-recently-visited room
      // once the current patrol leg is complete.
      if (navigator.isDone()) {
        const currentRoomId = nearestNodeId(GRAPH, botPosition);
        navigator.navigateTo(patrolPicker.pickNext(currentRoomId, tick), botPosition);
      }
      const { subgoalPosition } = navigator.tick(botPosition);
      moveDirection = seek(botPosition, subgoalPosition);
      yaw = Math.atan2(moveDirection.x, moveDirection.z);
    } else if (state.phase === 'search') {
      // Go to the last-seen point, hold briefly once there, then give up
      // (AE2) -- never steers toward the target's current, still-hidden
      // position; only ever the frozen sighting from the last acquired tick.
      if (navigator.isDone()) {
        moveDirection = { x: 0, z: 0 };
        // Face the frozen last-seen point, not facingYaw (which tracks the
        // player's live position every tick regardless of phase) -- using
        // facingYaw here visibly "stares" the bot through the wall at the
        // still-hidden player for the whole dwell window, contradicting the
        // honest-sensing guarantee this phase exists to enforce (R13/AE2).
        const dxSeen = state.lastSeenPosition.x - botPosition.x;
        const dzSeen = state.lastSeenPosition.z - botPosition.z;
        yaw = Math.atan2(dxSeen, dzSeen);
      } else {
        const { subgoalPosition } = navigator.tick(botPosition);
        moveDirection = seek(botPosition, subgoalPosition);
        yaw = Math.atan2(moveDirection.x, moveDirection.z);
      }
    } else {
      // chase or attack: close the distance, aim at the player (+ jitter);
      // movement and aim are decoupled (steering vs aim -- KTD4), so
      // avoidance can steer the bot around cover while it keeps facing/
      // firing at the player.
      moveDirection =
        distanceToPlayer > MOVE_DEADZONE ? seek(botPosition, playerPosition) : { x: 0, z: 0 };
      yaw = facingYaw + (random() * 2 - 1) * difficulty.aimSpread;
    }

    // Runs for every phase, including patrol (U3): real corridor/pillar
    // geometry means patrol movement needs avoidance now too, unlike the
    // old idle-phase wander(), which never left a wide-open box.
    moveDirection = avoidObstacles(rapierWorld, botPosition, moveDirection, excludeCollider);

    // ticksSinceFire runs unconditionally (not just while attacking), so a
    // bot that already spent a while chasing enters attack with its fire
    // interval already partly (or fully) elapsed -- reactionDelayTicks is
    // an independent, additional gate on the *first* shot of a fresh attack
    // episode, not a delay stacked before the interval timer even starts.
    ticksSinceFire += 1;
    const attackReady = state.phase === 'attack' && ticksSinceEnteredAttack >= difficulty.reactionDelayTicks;
    // KTD6: cadence is weapon-aware, not just a swapped-in interval number.
    // A held-fire weapon (the machine gun) sprays exactly like a player
    // holding the trigger -- the level stays up for the whole attack phase
    // and weapon.js's real per-tick cooldown is the only rate limiter, so
    // this module's own FIRE_INTERVAL_TICKS never applies to it. An
    // edge-fire weapon (the pistol) keeps today's intent-to-fire interval
    // exactly as before.
    const fireHeld = attackReady && isHeldFireWeapon(heldWeapon);
    if (attackReady && !fireHeld && ticksSinceFire >= FIRE_INTERVAL_TICKS) {
      ticksSinceFire = 0;
      fireLatch.press();
    }

    // Command expresses movement relative to facing (movement.js: forward =
    // (sin(yaw), cos(yaw)), right = (-cos(yaw), sin(yaw)) -- camera-visual
    // right, not just any perpendicular; must match movement.js's basis
    // exactly or a bot's intended world-space direction desyncs on decode);
    // project the world-space moveDirection onto that orthonormal basis to
    // recover yaw-relative moveZ/moveX.
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    const moveZ = moveDirection.x * forward.x + moveDirection.z * forward.z;
    const moveX = moveDirection.x * right.x + moveDirection.z * right.z;

    return createCommand({
      moveX,
      moveZ,
      yaw,
      pitch: 0,
      // Bots never throw (KD3: grenade pickups are player-only) -- throwGrenade
      // stays permanently false rather than wiring a latch nothing presses.
      buttons: { fire: fireLatch.consume(), fireHeld, jump: false, throwGrenade: false },
    });
  }

  return { sample, getPhase: () => state.phase, reset };
}
