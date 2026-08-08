// Reinforcements arrive by drop rather than materialising on the floor. The
// descent lives in the simulation, not the render layer, so a falling bot's
// hitbox is where it looks -- this file pins that, because a render-only
// version would look identical right up until you shot at one.
import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCommand } from '../../src/sim/command.js';
import { AIRDROP_HEIGHT } from '../../src/sim/health.js';
import { buildBotRig, addEntity, primeBroadPhase } from '../support/rig.js';

await RAPIER.init();

const FIRE = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: true, jump: false, throwGrenade: false } });
const HOLD = createCommand({ yaw: 0, pitch: 0, buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false } });

const SPAWN = { x: 20, y: 1, z: 20 };

// Kills 'target' and returns the rig on the tick it respawns into its drop.
function rigWithTargetDropping() {
  const rig = buildBotRig({ spawnPoints: [SPAWN] });
  addEntity(rig, 'shooter', { x: 0, y: 1, z: 0 });
  addEntity(rig, 'target', { x: 0, y: 1, z: 5 });
  primeBroadPhase(rig);

  for (let i = 0; i < 60 && !rig.world.getEntity('target').dead; i += 1) {
    rig.world.step(new Map([['shooter', FIRE], ['target', HOLD]]), 1 / 60);
  }
  // Step to the exact tick it comes back, so the first airborne sample is
  // the top of the drop rather than wherever a fixed loop count landed.
  while (rig.world.getEntity('target').dead) {
    rig.world.step(new Map([['shooter', HOLD]]), 1 / 60);
  }
  return rig;
}

describe('airdropped arrivals', () => {
  it('respawns a bot in the air above its spawn point, not standing on it', () => {
    const target = rigWithTargetDropping().world.getEntity('target');

    expect(target.dead).toBe(false);
    expect(target.airdropping).toBe(true);
    // Within one tick's descent of the full drop height: the respawn and
    // the first step of the fall resolve in the same tick.
    expect(target.position.y).toBeGreaterThan(SPAWN.y + AIRDROP_HEIGHT - 1);
    expect(target.position.y).toBeLessThanOrEqual(SPAWN.y + AIRDROP_HEIGHT);
    // Over the spawn point, so it lands exactly where it would have appeared.
    expect(target.position.x).toBe(SPAWN.x);
    expect(target.position.z).toBe(SPAWN.z);
  });

  it('descends to the spawn point and clears the flag on landing', () => {
    const rig = rigWithTargetDropping();
    const startY = rig.world.getEntity('target').position.y;

    rig.world.step(new Map([['shooter', HOLD]]), 1 / 60);
    expect(rig.world.getEntity('target').position.y).toBeLessThan(startY);

    for (let i = 0; i < 200; i += 1) rig.world.step(new Map([['shooter', HOLD]]), 1 / 60);

    const target = rig.world.getEntity('target');
    expect(target.position.y).toBeCloseTo(SPAWN.y, 5);
    expect(target.airdropping).toBe(false);
  });

  it('never descends below the spawn point it is aiming for', () => {
    const rig = rigWithTargetDropping();
    let lowest = Infinity;
    for (let i = 0; i < 200; i += 1) {
      rig.world.step(new Map([['shooter', HOLD]]), 1 / 60);
      lowest = Math.min(lowest, rig.world.getEntity('target').position.y);
    }
    expect(lowest).toBeGreaterThanOrEqual(SPAWN.y);
  });

  it('keeps the collider on the falling bot, so it can be shot on the way down', () => {
    const rig = rigWithTargetDropping();
    // One more tick, so the teleport issued during the respawn has been
    // through a physics step -- the collider reports its previous pose until
    // then, which is a property of the character controller, not the drop.
    rig.world.step(new Map([['shooter', HOLD]]), 1 / 60);

    const target = rig.world.getEntity('target');
    const colliderY = rig.movementSystem.getCollider('target').translation().y;

    // The whole reason this is simulation rather than animation: a render-
    // only descent would leave the hitbox on the floor -- fourteen units
    // below the bot -- for the entire fall. It tracks within one tick's
    // worth of descent, which is the same lag every moving entity's
    // kinematic collider has and is far inside the 1.8-unit capsule.
    expect(Math.abs(colliderY - target.position.y)).toBeLessThan(0.5);
    expect(colliderY).toBeGreaterThan(SPAWN.y + 1);
  });
});
