import { describe, expect, it } from 'vitest';
import { createInputSampler } from '../../src/input/sampler.js';

describe('createInputSampler', () => {
  it('clamps pitch to just short of +-90deg', () => {
    const sampler = createInputSampler();
    for (let i = 0; i < 2000; i++) {
      sampler.onMouseMove({ movementX: 0, movementY: -100 });
    }
    const { pitch } = sampler.getYawPitch();
    expect(pitch).toBeLessThanOrEqual(Math.PI / 2);

    for (let i = 0; i < 2000; i++) {
      sampler.onMouseMove({ movementX: 0, movementY: 100 });
    }
    expect(sampler.getYawPitch().pitch).toBeGreaterThanOrEqual(-Math.PI / 2);
  });

  it('maps each single WASD key to its own moveX/moveZ axis', () => {
    const sampler = createInputSampler();
    sampler.onKeyDown({ code: 'KeyW' });
    expect(sampler.sample()).toMatchObject({ moveZ: 1, moveX: 0 });

    sampler.onKeyUp({ code: 'KeyW' });
    sampler.onKeyDown({ code: 'KeyS' });
    expect(sampler.sample()).toMatchObject({ moveZ: -1, moveX: 0 });

    sampler.onKeyUp({ code: 'KeyS' });
    sampler.onKeyDown({ code: 'KeyD' });
    expect(sampler.sample()).toMatchObject({ moveZ: 0, moveX: 1 });

    sampler.onKeyUp({ code: 'KeyD' });
    sampler.onKeyDown({ code: 'KeyA' });
    expect(sampler.sample()).toMatchObject({ moveZ: 0, moveX: -1 });
  });

  it('normalizes diagonal input so combined-axis speed never exceeds single-axis speed (finding #12)', () => {
    const sampler = createInputSampler();
    sampler.onKeyDown({ code: 'KeyW' });
    sampler.onKeyDown({ code: 'KeyD' });
    const forwardRight = sampler.sample();
    expect(Math.hypot(forwardRight.moveX, forwardRight.moveZ)).toBeCloseTo(1, 10);
    expect(forwardRight.moveX).toBeCloseTo(forwardRight.moveZ, 10); // equal split between the two held axes

    sampler.onKeyUp({ code: 'KeyW' });
    sampler.onKeyDown({ code: 'KeyS' });
    const backRight = sampler.sample();
    expect(Math.hypot(backRight.moveX, backRight.moveZ)).toBeCloseTo(1, 10);
    expect(backRight.moveZ).toBeCloseTo(-backRight.moveX, 10);
  });

  it('maps the Space key to the jump button', () => {
    const sampler = createInputSampler();
    expect(sampler.sample().buttons.jump).toBe(false);
    sampler.onKeyDown({ code: 'Space' });
    expect(sampler.sample().buttons.jump).toBe(true);
  });

  it('latches a fire press to exactly one sampled command', () => {
    const sampler = createInputSampler();
    expect(sampler.sample().buttons.fire).toBe(false);

    sampler.onFirePressed();
    expect(sampler.sample().buttons.fire).toBe(true);
    expect(sampler.sample().buttons.fire).toBe(false);
  });

  it('tracks a held-fire level: true from press until release, independent of the fire edge latch', () => {
    const sampler = createInputSampler();
    expect(sampler.sample().buttons.fireHeld).toBe(false);

    sampler.onFirePressed();
    expect(sampler.sample().buttons.fireHeld).toBe(true);
    expect(sampler.sample().buttons.fireHeld).toBe(true); // still held on a later sample, unlike the edge latch
    expect(sampler.sample().buttons.fire).toBe(false); // the edge was already consumed by the first sample() above

    sampler.onFireReleased();
    expect(sampler.sample().buttons.fireHeld).toBe(false);
  });

  it('latches a throw-key press to exactly one sampled command', () => {
    const sampler = createInputSampler();
    expect(sampler.sample().buttons.throwGrenade).toBe(false);

    sampler.onKeyDown({ code: 'KeyG' });
    expect(sampler.sample().buttons.throwGrenade).toBe(true);
    expect(sampler.sample().buttons.throwGrenade).toBe(false);
  });

  it('ignores the browser repeating keydown while KeyG is held, queuing only one throw per physical press', () => {
    const sampler = createInputSampler();
    sampler.onKeyDown({ code: 'KeyG' }); // physical key-down
    sampler.onKeyDown({ code: 'KeyG' }); // native key-repeat, still held
    sampler.onKeyDown({ code: 'KeyG' }); // native key-repeat, still held

    expect(sampler.sample().buttons.throwGrenade).toBe(true);
    expect(sampler.sample().buttons.throwGrenade).toBe(false); // only one press was ever queued

    sampler.onKeyUp({ code: 'KeyG' });
    sampler.onKeyDown({ code: 'KeyG' }); // a fresh physical press queues a fresh throw
    expect(sampler.sample().buttons.throwGrenade).toBe(true);
  });

  it('clearHeldInput drops held movement keys and the fire-held level (window blur)', () => {
    const sampler = createInputSampler();
    sampler.onKeyDown({ code: 'KeyW' });
    sampler.onFirePressed(); // sets fireHeld true and queues one edge-triggered shot

    sampler.clearHeldInput();

    const command = sampler.sample();
    expect(command.moveZ).toBe(0); // KeyW no longer reads as held
    expect(command.buttons.fireHeld).toBe(false);
  });

  it('setYaw sets the yaw directly without touching pitch', () => {
    const sampler = createInputSampler();
    sampler.onMouseMove({ movementX: 0, movementY: -50 }); // establish a non-zero pitch
    const pitchBefore = sampler.getYawPitch().pitch;

    sampler.setYaw(1.23);

    expect(sampler.getYawPitch().yaw).toBe(1.23);
    expect(sampler.getYawPitch().pitch).toBe(pitchBefore);
  });
});
