import { describe, expect, it } from 'vitest';
import { computeAngleFromPlayer } from '../../src/render/feedback.js';

const ORIGIN = { x: 0, y: 1, z: 0 };

describe('computeAngleFromPlayer', () => {
  it('returns ~0 when the attacker is directly ahead of the player view', () => {
    const angle = computeAngleFromPlayer(ORIGIN, 0, { x: 0, y: 1, z: 5 });
    expect(angle).toBeCloseTo(0, 5);
  });

  it('returns a positive angle when the attacker is to the player\'s right', () => {
    const angle = computeAngleFromPlayer(ORIGIN, 0, { x: 5, y: 1, z: 0 });
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it("returns a negative angle when the attacker is to the player's left", () => {
    const angle = computeAngleFromPlayer(ORIGIN, 0, { x: -5, y: 1, z: 0 });
    expect(angle).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('wraps a directly-behind attacker to +-pi, not a discontinuous jump', () => {
    const angle = computeAngleFromPlayer(ORIGIN, 0, { x: 0, y: 1, z: -5 });
    expect(Math.abs(angle)).toBeCloseTo(Math.PI, 5);
  });

  it('is relative to the player\'s current view yaw, not world-absolute', () => {
    const facingRight = Math.PI / 2;
    const angle = computeAngleFromPlayer(ORIGIN, facingRight, { x: 5, y: 1, z: 0 });
    expect(angle).toBeCloseTo(0, 5); // attacker is where the player is now looking
  });
});
