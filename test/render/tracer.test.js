import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTracerSystem, TRACER_START_OFFSET } from '../../src/render/tracer.js';

describe('createTracerSystem', () => {
  // A Mesh, not a THREE.Line: the renderer ignores LineBasicMaterial.linewidth,
  // so a Line tracer is always one pixel wide and effectively invisible at
  // arena range. Width is the whole point of a tracer, so it stopped being a
  // Line -- this assertion guards against it quietly reverting.
  it('adds a beam to the scene reaching endPoint, starting clear of the shooter', () => {
    const scene = new THREE.Scene();
    const tracers = createTracerSystem(scene);

    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 });

    expect(scene.children.length).toBe(1);
    const [beam] = scene.children;
    expect(beam).toBeInstanceOf(THREE.Mesh);
    expect(beam).not.toBeInstanceOf(THREE.Line);
    // The beam covers the shot from TRACER_START_OFFSET to the impact: the
    // near-eye stretch is deliberately skipped, because the local player's
    // fire origin is the camera and a beam drawn from there fills the screen.
    expect(beam.position.z).toBeCloseTo(TRACER_START_OFFSET, 5);
    expect(beam.scale.y).toBeCloseTo(10 - TRACER_START_OFFSET, 5);
    // Still ends where the shot landed.
    expect(beam.position.z + beam.scale.y).toBeCloseTo(10, 5);
  });

  it('skips a shot that lands inside the near-field offset instead of drawing a stub', () => {
    const scene = new THREE.Scene();
    const tracers = createTracerSystem(scene);

    // Point blank against a wall: any beam here would be the near-eye band
    // the offset exists to remove. The muzzle flash and impact spark cover it.
    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: TRACER_START_OFFSET / 2 });

    expect(scene.children.length).toBe(0);
  });

  it('ignores a zero-length shot rather than producing a NaN orientation', () => {
    const scene = new THREE.Scene();
    const tracers = createTracerSystem(scene);

    tracers.spawn({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });

    expect(scene.children.length).toBe(0);
  });

  it('removes and disposes the tracer once its lifetime elapses', () => {
    const scene = new THREE.Scene();
    const tracers = createTracerSystem(scene);

    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 });
    tracers.update(0.5); // well past the ~0.08s lifetime

    expect(scene.children.length).toBe(0);
  });

  it('fades opacity down over its lifetime without removing it early', () => {
    const scene = new THREE.Scene();
    const tracers = createTracerSystem(scene);

    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 });
    tracers.update(0.04); // partway through the lifetime

    expect(scene.children.length).toBe(1);
    expect(scene.children[0].material.opacity).toBeGreaterThan(0);
    expect(scene.children[0].material.opacity).toBeLessThan(1);
  });

  it('tracks multiple concurrent tracers independently', () => {
    const scene = new THREE.Scene();
    const tracers = createTracerSystem(scene);

    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 });
    tracers.update(0.5); // first tracer now expired
    tracers.spawn({ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 10 });

    expect(scene.children.length).toBe(1);
  });
});
