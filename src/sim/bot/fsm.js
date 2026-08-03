// Bot decision-making (KTD4): Idle/Patrol -> Chase -> Attack -> Retreat,
// sensed via distance plus a line-of-sight raycast against the sim world.
// transitionBotState is a pure reducer (mirrors shell/states.js's
// transition() shape, but over a continuous sensor bundle rather than a
// discrete event, so it owns its own distance/health thresholds rather than
// deferring to difficulty.js's per-bot tunables). createBotAI is the
// stateful wrapper that senses, decides, steers, and emits a Command --
// still the same shape the player emits (KTD2).
import RAPIER from '@dimforge/rapier3d-compat';
import { createCommand, createFireLatch } from '../command.js';
import { EYE_HEIGHT, CAPSULE_RADIUS } from '../movement.js';
import { seek, flee, wander, avoidObstacles } from './steering.js';
import { DEFAULT_DIFFICULTY } from './difficulty.js';

// Sized against the arena's actual scale (arena.js: ARENA_HALF_SIZE = 30, so
// a ~60x60 floor with spawn points up to ~55 units apart) -- these were
// first written smaller, before that resize, and left bots unable to ever
// notice or engage the player across a realistic spawn separation (caught
// by live play, not by unit tests using close-together synthetic positions).
export const ATTACK_RANGE = 25;
export const AWARENESS_RANGE = 50;
export const RETREAT_HEALTH_THRESHOLD = 30;
export const RETREAT_DURATION_TICKS = 180; // ~3s at 60Hz
const MOVE_DEADZONE = 1.5; // stop closing once this close, so bots don't shove into the player
const FIRE_INTERVAL_TICKS = 45; // intent to fire ~1.3x/sec; weapon.js's cooldown still bounds actual rate

export function createInitialBotState() {
  return { phase: 'idle', retreatArmed: true, retreatEndTick: 0 };
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
  const { distanceToPlayer, hasLineOfSight, health } = sensors;
  const armed = health >= RETREAT_HEALTH_THRESHOLD ? true : state.retreatArmed;

  if (armed && health < RETREAT_HEALTH_THRESHOLD && state.phase !== 'retreat') {
    return { phase: 'retreat', retreatArmed: false, retreatEndTick: tick + RETREAT_DURATION_TICKS };
  }
  if (state.phase === 'retreat') {
    if (tick < state.retreatEndTick) return { phase: 'retreat', retreatArmed: armed, retreatEndTick: state.retreatEndTick };
    return { phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
  }

  if (hasLineOfSight && distanceToPlayer <= ATTACK_RANGE) {
    return { phase: 'attack', retreatArmed: armed, retreatEndTick: 0 };
  }
  if (hasLineOfSight || distanceToPlayer <= AWARENESS_RANGE) {
    return { phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
  }
  return { phase: 'idle', retreatArmed: armed, retreatEndTick: 0 };
}

function checkLineOfSight(rapierWorld, fromPosition, toPosition, excludeCollider) {
  const origin = { x: fromPosition.x, y: fromPosition.y + EYE_HEIGHT, z: fromPosition.z };
  const target = { x: toPosition.x, y: toPosition.y + EYE_HEIGHT, z: toPosition.z };
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) return true;
  const direction = { x: dx / distance, y: dy / distance, z: dz / distance };

  // Stop short of the target's own capsule surface, not just its center --
  // otherwise the ray reaches in, legitimately hits the target itself, and
  // that hit gets misread as "something is blocking the view of them" (this
  // is exactly what happened here: with only a flat 0.1 buffer, a target
  // 3.2 units away -- well within its own 0.3-radius capsule surface at
  // ~2.9 units -- registered as blocked even with a dead-clear line to it).
  const hit = rapierWorld.castRay(
    new RAPIER.Ray(origin, direction),
    Math.max(distance - CAPSULE_RADIUS - 0.05, 0),
    true,
    undefined,
    undefined,
    excludeCollider
  );
  return !hit;
}

export function createBotAI({ rapierWorld, movementSystem, botId, difficulty = DEFAULT_DIFFICULTY, random = Math.random }) {
  const fireLatch = createFireLatch();
  const excludeCollider = movementSystem.getCollider(botId);
  let state = createInitialBotState();
  let tick = 0;
  let ticksSinceEnteredAttack = 0;
  let ticksSinceFire = 0;
  let wanderYaw = 0;

  function sample(botPosition, playerPosition, botHealth) {
    tick += 1;
    const dx = playerPosition.x - botPosition.x;
    const dz = playerPosition.z - botPosition.z;
    const distanceToPlayer = Math.hypot(dx, dz);
    const facingYaw = Math.atan2(dx, dz);
    const hasLineOfSight = checkLineOfSight(rapierWorld, botPosition, playerPosition, excludeCollider);

    const previousPhase = state.phase;
    state = transitionBotState(state, { distanceToPlayer, hasLineOfSight, health: botHealth }, tick);
    if (state.phase === 'attack') {
      ticksSinceEnteredAttack = previousPhase === 'attack' ? ticksSinceEnteredAttack + 1 : 0;
    }

    let moveDirection;
    let yaw;
    if (state.phase === 'retreat') {
      moveDirection = flee(botPosition, playerPosition);
      yaw = Math.atan2(moveDirection.x, moveDirection.z);
    } else if (state.phase === 'idle') {
      const drift = wander(wanderYaw, random);
      wanderYaw = drift.yaw;
      moveDirection = { x: drift.x, z: drift.z };
      yaw = wanderYaw;
    } else {
      // chase or attack: close the distance, aim at the player (+ jitter);
      // movement and aim are decoupled (steering vs aim -- KTD4), so
      // avoidance can steer the bot around cover while it keeps facing/
      // firing at the player.
      moveDirection =
        distanceToPlayer > MOVE_DEADZONE ? seek(botPosition, playerPosition) : { x: 0, z: 0 };
      yaw = facingYaw + (random() * 2 - 1) * difficulty.aimSpread;
    }

    if (state.phase !== 'idle') {
      moveDirection = avoidObstacles(rapierWorld, botPosition, moveDirection, excludeCollider);
    }

    // ticksSinceFire runs unconditionally (not just while attacking), so a
    // bot that already spent a while chasing enters attack with its fire
    // interval already partly (or fully) elapsed -- reactionDelayTicks is
    // an independent, additional gate on the *first* shot of a fresh attack
    // episode, not a delay stacked before the interval timer even starts.
    ticksSinceFire += 1;
    const readyToFire =
      state.phase === 'attack' &&
      ticksSinceEnteredAttack >= difficulty.reactionDelayTicks &&
      ticksSinceFire >= FIRE_INTERVAL_TICKS;
    if (readyToFire) {
      ticksSinceFire = 0;
      fireLatch.press();
    }

    // Command expresses movement relative to facing (movement.js: forward =
    // (sin(yaw), cos(yaw)), right = (cos(yaw), -sin(yaw))); project the
    // world-space moveDirection onto that orthonormal basis to recover
    // yaw-relative moveZ/moveX.
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const moveZ = moveDirection.x * forward.x + moveDirection.z * forward.z;
    const moveX = moveDirection.x * right.x + moveDirection.z * right.z;

    return createCommand({
      moveX,
      moveZ,
      yaw,
      pitch: 0,
      buttons: { fire: fireLatch.consume(), jump: false },
    });
  }

  return { sample, getPhase: () => state.phase };
}
