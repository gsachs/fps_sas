import { describe, expect, it } from 'vitest';
import { createFixedStepLoop } from '../../src/sim/loop.js';

describe('createFixedStepLoop', () => {
  it('steps at a fixed dt regardless of the real frame delta', () => {
    let stepCount = 0;
    const loop = createFixedStepLoop({ dt: 1 / 60, onStep: () => stepCount++ });

    loop.tick(1 / 60); // exactly one tick worth
    expect(stepCount).toBe(1);

    loop.tick(2 / 60); // two more ticks worth
    expect(stepCount).toBe(3);
  });

  it('clamps a long frame delta so it cannot spiral into a huge step count', () => {
    let stepCount = 0;
    const loop = createFixedStepLoop({ dt: 1 / 60, maxFrameSeconds: 0.25, onStep: () => stepCount++ });

    loop.tick(10); // a 10s stall (e.g. tab refocus) must not run 600 steps

    expect(stepCount).toBeLessThanOrEqual(Math.ceil(0.25 / (1 / 60)) + 1);
  });

  it('returns alpha as the fractional progress toward the next tick', () => {
    const loop = createFixedStepLoop({ dt: 1 / 60, onStep: () => {} });
    const alpha = loop.tick(0.5 / 60);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('produces the same number of steps for the same sequence of frame deltas', () => {
    const deltas = [1 / 60, 1.5 / 60, 0.7 / 60, 3 / 60, 0.9 / 60];

    function run() {
      let count = 0;
      const loop = createFixedStepLoop({ dt: 1 / 60, onStep: () => count++ });
      for (const d of deltas) loop.tick(d);
      return count;
    }

    expect(run()).toBe(run());
  });
});
