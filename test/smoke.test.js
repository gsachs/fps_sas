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

  it('lights ambient from the sky rather than a single flat term', () => {
    const { scene } = createScene();

    const hemisphere = scene.children.find((child) => child.isHemisphereLight);
    expect(hemisphere).toBeDefined();
    // A flat AmbientLight would leave every face of a box identically lit,
    // which is most of why untextured geometry reads as unfinished (R14).
    expect(scene.children.some((child) => child.isAmbientLight)).toBe(false);
  });

  it('casts shadows from a sun whose shadow camera covers the arena', () => {
    const { scene } = createScene();

    const sun = scene.children.find((child) => child.isDirectionalLight);
    expect(sun).toBeDefined();
    expect(sun.castShadow).toBe(true);
    // The arena is 30 units half-size; geometry outside the shadow camera's
    // box stops casting with no error, so this guards the extent (R12).
    expect(sun.shadow.camera.right).toBeGreaterThanOrEqual(30);
    expect(sun.shadow.camera.top).toBeGreaterThanOrEqual(30);
    expect(sun.shadow.camera.far).toBeGreaterThan(sun.position.length());
  });

  it('keeps fog clear of the arena so distant bots stay readable', () => {
    const { scene } = createScene();

    // Cover sits out to 10 units and the far wall to 30; fog closing in
    // before that would hide targets at the range they matter most (R15).
    expect(scene.fog.near).toBeGreaterThan(30);
  });
});
