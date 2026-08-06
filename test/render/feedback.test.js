import { describe, expect, it } from 'vitest';
import { computeAngleFromPlayer } from '../../src/render/feedback.js';

const ORIGIN = { x: 0, y: 1, z: 0 };

// Ground truth for "camera-visual right", copied from movement.js's own
// live-verified basis (movement.js:85, confirmed via a Playwright
// dot-product measurement -- see
// docs/solutions/logic-errors/strafe-direction-camera-basis-mismatch.md
// and test/sim/movement.test.js's identical helper). Directional test
// attacker positions are derived from this vector rather than hardcoded,
// so a test can't silently agree with a wrong left/right convention the
// way the original version of this file did.
function visualRight(yaw) {
  return { x: -Math.cos(yaw), z: Math.sin(yaw) };
}

describe('computeAngleFromPlayer', () => {
  it('returns ~0 when the attacker is directly ahead of the player view', () => {
    const angle = computeAngleFromPlayer(ORIGIN, 0, { x: 0, y: 1, z: 5 });
    expect(angle).toBeCloseTo(0, 5);
  });

  it('returns a positive angle when the attacker is to the player\'s right', () => {
    const yaw = 0;
    const right = visualRight(yaw);
    const attackerPosition = { x: ORIGIN.x + right.x * 5, y: 1, z: ORIGIN.z + right.z * 5 };
    const angle = computeAngleFromPlayer(ORIGIN, yaw, attackerPosition);
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it("returns a negative angle when the attacker is to the player's left", () => {
    const yaw = 0;
    const right = visualRight(yaw);
    const attackerPosition = { x: ORIGIN.x - right.x * 5, y: 1, z: ORIGIN.z - right.z * 5 };
    const angle = computeAngleFromPlayer(ORIGIN, yaw, attackerPosition);
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
