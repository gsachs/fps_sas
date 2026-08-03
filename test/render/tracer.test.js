import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTracerSystem } from '../../src/render/tracer.js';

describe('createTracerSystem', () => {
  // A Mesh, not a THREE.Line: the renderer ignores LineBasicMaterial.linewidth,
  // so a Line tracer is always one pixel wide and effectively invisible at
  // arena range. Width is the whole point of a tracer, so it stopped being a
  // Line -- this assertion guards against it quietly reverting.
  it('adds a beam to the scene spanning origin to endPoint', () => {
    const scene = new THREE.Scene();
    const tracers = createTracerSystem(scene);

    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 });

    expect(scene.children.length).toBe(1);
    expect(scene.children[0]).toBeInstanceOf(THREE.Mesh);
    expect(scene.children[0]).not.toBeInstanceOf(THREE.Line);
    // Stretched to span the full 10 units between the two points.
    expect(scene.children[0].scale.y).toBeCloseTo(10, 5);
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
