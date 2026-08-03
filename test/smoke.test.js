import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createScene } from '../src/render/scene.js';

describe('createScene', () => {
  it('builds a scene with a camera and lighting', () => {
    const { scene, camera } = createScene();

    expect(scene).toBeInstanceOf(THREE.Scene);
    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);

    const lights = scene.children.filter((child) => child.isLight);
    expect(lights.length).toBeGreaterThanOrEqual(2);
  });
});
