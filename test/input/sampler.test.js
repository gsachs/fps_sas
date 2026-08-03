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

  it('maps WASD to moveX/moveZ', () => {
    const sampler = createInputSampler();
    sampler.onKeyDown({ code: 'KeyW' });
    sampler.onKeyDown({ code: 'KeyD' });
    expect(sampler.sample()).toMatchObject({ moveZ: 1, moveX: 1 });

    sampler.onKeyUp({ code: 'KeyW' });
    sampler.onKeyDown({ code: 'KeyS' });
    expect(sampler.sample()).toMatchObject({ moveZ: -1, moveX: 1 });
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
});
