// The start screen's camera. Pure, so the orbit can be checked without a
// renderer -- which matters because the failure it replaced was invisible in
// exactly that way: the camera was never positioned at all, and the very
// first screen anyone saw was the underside of the world.
import { describe, expect, it } from 'vitest';
import { ATTRACT_ORBIT, attractCameraPose } from '../../src/render/attractCamera.js';
import { FLOOR_HALF_SIZE, WALL_HEIGHT } from '../../src/arena/layout.js';

const samples = Array.from({ length: 64 }, (_, i) =>
  attractCameraPose((i / 64) * ATTRACT_ORBIT.ORBIT_PERIOD_SECONDS)
);

describe('attract camera orbit', () => {
  it('stays above the walls, so it looks into the site rather than at the outside of one', () => {
    for (const pose of samples) {
      expect(pose.position.y).toBeGreaterThan(WALL_HEIGHT * 2);
    }
  });

  it('stays inside the floor, so the site is never seen from off the edge of the world', () => {
    // Outside this, the camera looks back at an arena floating on nothing --
    // the floor plane ends and the skybox takes over underneath it.
    for (const pose of samples) {
      expect(Math.abs(pose.position.x)).toBeLessThan(FLOOR_HALF_SIZE);
      expect(Math.abs(pose.position.z)).toBeLessThan(FLOOR_HALF_SIZE);
    }
  });

  it('always faces the middle of the built geometry, not the world origin', () => {
    // The districts sprawl further north and east than south and west, so
    // aiming at (0,0) would leave one side off frame for half the orbit.
    for (const pose of samples) {
      expect(pose.lookAt.x).toBeCloseTo(ATTRACT_ORBIT.CENTRE.x, 6);
      expect(pose.lookAt.z).toBeCloseTo(ATTRACT_ORBIT.CENTRE.z, 6);
    }
  });

  it('goes all the way round, showing every district over one period', () => {
    const bearings = samples.map((pose) =>
      Math.atan2(pose.position.x - ATTRACT_ORBIT.CENTRE.x, pose.position.z - ATTRACT_ORBIT.CENTRE.z)
    );
    expect(Math.min(...bearings)).toBeLessThan(-Math.PI * 0.9);
    expect(Math.max(...bearings)).toBeGreaterThan(Math.PI * 0.9);
  });

  it('wraps without a jump, so the loop is not visible as a cut', () => {
    const step = (at) => {
      const a = attractCameraPose(at - 0.001);
      const b = attractCameraPose(at + 0.001);
      return Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
    };
    // Against an ordinary step rather than against zero: the camera really is
    // moving across the wrap, and it should be moving by exactly as much
    // there as anywhere else. A fixed tolerance would only be testing how
    // fast the orbit happens to be.
    const acrossWrap = step(ATTRACT_ORBIT.ORBIT_PERIOD_SECONDS);
    const midOrbit = step(ATTRACT_ORBIT.ORBIT_PERIOD_SECONDS * 0.37);
    expect(acrossWrap).toBeCloseTo(midOrbit, 6);
  });

  it('holds a constant radius, so the drift reads as an orbit not a swoop', () => {
    const radii = samples.map((pose) =>
      Math.hypot(pose.position.x - ATTRACT_ORBIT.CENTRE.x, pose.position.z - ATTRACT_ORBIT.CENTRE.z)
    );
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-9);
  });
});
