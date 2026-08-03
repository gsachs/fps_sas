import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createScene } from '../src/render/scene.js';

describe('createScene', () => {
  it('builds a scene with a camera, lighting, and placeholder geometry', () => {
    const { scene, camera } = createScene();

    expect(scene).toBeInstanceOf(THREE.Scene);
    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(scene.getObjectByName('ground')).toBeDefined();
    expect(scene.getObjectByName('placeholder-box')).toBeDefined();
  });
});
