// The shadow camera is the one render setting that fails silently: a caster
// outside its frustum still renders, it just stops grounding itself, which
// reads as a wall floating with light leaking under it. That has now shipped
// twice -- once from a hardcoded extent, once from a sun standing too close
// for its own near plane -- and both times a human playtest was the only
// thing that caught it. This projects every wall and pillar corner into the
// light's own space and checks all four limits (near, far, and both
// orthographic extents), so the whole class is guarded rather than the one
// axis each fix happened to touch.
import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../src/arena/layout.js';
import { createScene } from '../../src/render/scene.js';

// A right-handed basis looking from `position` toward the origin, matching
// how three.js orients a DirectionalLight's shadow camera at its default
// target with its default up vector.
function lightSpaceBasis(position) {
  const length = Math.hypot(position.x, position.y, position.z);
  const forward = { x: -position.x / length, y: -position.y / length, z: -position.z / length };
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const normalize = (v) => {
    const l = Math.hypot(v.x, v.y, v.z);
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  const back = { x: -forward.x, y: -forward.y, z: -forward.z };
  const right = normalize(cross({ x: 0, y: 1, z: 0 }, back));
  return { forward, right, up: cross(back, right) };
}

function casterCorners() {
  const corners = [];
  for (const box of [...LAYOUT.walls, ...LAYOUT.pillars]) {
    for (const sx of [-1, 1]) {
      for (const sy of [0, 1]) {
        for (const sz of [-1, 1]) {
          corners.push({
            label: box.spaceId ?? box.id,
            x: box.x + sx * box.halfX,
            y: sy * box.halfY * 2,
            z: box.z + sz * box.halfZ,
          });
        }
      }
    }
  }
  return corners;
}

describe('shadow camera coverage', () => {
  it('contains every wall and pillar corner within all four frustum limits', () => {
    const { scene } = createScene();
    const sun = scene.children.find((child) => child.isDirectionalLight);
    const { forward, right, up } = lightSpaceBasis(sun.position);
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const camera = sun.shadow.camera;

    for (const corner of casterCorners()) {
      const relative = {
        x: corner.x - sun.position.x,
        y: corner.y - sun.position.y,
        z: corner.z - sun.position.z,
      };
      const depth = dot(relative, forward);
      const horizontal = dot(relative, right);
      const vertical = dot(relative, up);
      const where = `${corner.label} corner (${corner.x}, ${corner.y}, ${corner.z})`;

      expect(depth, `${where} is behind the shadow camera's near plane`).toBeGreaterThan(camera.near);
      expect(depth, `${where} is past the shadow camera's far plane`).toBeLessThan(camera.far);
      expect(Math.abs(horizontal), `${where} is outside the shadow box horizontally`).toBeLessThan(
        camera.right
      );
      expect(Math.abs(vertical), `${where} is outside the shadow box vertically`).toBeLessThan(
        camera.top
      );
    }
  });

  it('keeps both shadow offsets too small to lift a shadow off its own caster', () => {
    const { scene } = createScene();
    const sun = scene.children.find((child) => child.isDirectionalLight);
    const { near, far } = sun.shadow.camera;

    // Both offsets push a receiver's shadow test toward the light, so both
    // surface as the same defect: a lit seam where a wall meets the floor.
    // They are bounded together because they add.
    //
    // `bias` is the one that drifts. three.js scales it by the camera's
    // depth span, so a fixed literal silently means a larger world distance
    // every time the arena -- and with it that span -- grows; bounding the
    // product rather than the literal is what survives the next resize.
    // `normalBias` is already in world units.
    //
    // The threshold is measured, not assumed: sampling the live framebuffer
    // across a wall/floor junction, the seam is level with the floor below
    // ~0.02 world units of combined offset and clearly visible by 0.05.
    const depthBiasInWorldUnits = Math.abs(sun.shadow.bias) * (far - near);
    expect(depthBiasInWorldUnits + sun.shadow.normalBias).toBeLessThan(0.02);
  });

  it('sizes the shadow box from the live floor scalar, not a copied constant', () => {
    const { scene } = createScene();
    const sun = scene.children.find((child) => child.isDirectionalLight);

    // Both directions, so shrinking the arena is caught as well as growing
    // it -- an over-wide box is wasted shadow-map resolution, which is the
    // failure mode that does not announce itself either.
    expect(sun.shadow.camera.right).toBeGreaterThan(LAYOUT.floorHalfSize);
    expect(sun.shadow.camera.right).toBeLessThan(LAYOUT.floorHalfSize * 1.25);
    expect(sun.shadow.camera.top).toBe(sun.shadow.camera.right);
  });
});
