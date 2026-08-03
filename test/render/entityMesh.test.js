import { describe, expect, it } from 'vitest';
import { computeBotMeshYaw } from '../../src/render/entityMesh.js';

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
