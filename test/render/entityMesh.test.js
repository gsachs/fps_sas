import { describe, expect, it } from 'vitest';
import { computeBotMeshYaw, computeBotMeshY } from '../../src/render/entityMesh.js';

describe('computeBotMeshYaw', () => {
  it('matches entity yaw when the model has no rest-facing offset', () => {
    expect(computeBotMeshYaw(1.2, 0)).toBeCloseTo(1.2);
  });

  it('composes a rig-specific offset instead of discarding it', () => {
    expect(computeBotMeshYaw(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(computeBotMeshYaw(0.5, Math.PI)).toBeCloseTo(0.5 + Math.PI);
  });

  it('defaults the offset to 0 when omitted', () => {
    expect(computeBotMeshYaw(0.7)).toBeCloseTo(0.7);
  });
});

describe('computeBotMeshY', () => {
  it('matches entity Y when the model has no vertical offset', () => {
    expect(computeBotMeshY(1, 0)).toBeCloseTo(1);
  });

  it('composes a rig-specific vertical offset instead of discarding it', () => {
    // Regression case: a feet-anchored rig floated ~0.8 units above its
    // actual (center-anchored) capsule collider, letting shots aimed at the
    // visible character sail over the real hitbox.
    expect(computeBotMeshY(1, -0.8)).toBeCloseTo(0.2);
  });

  it('defaults the offset to 0 when omitted', () => {
    expect(computeBotMeshY(1.5)).toBeCloseTo(1.5);
  });
});
