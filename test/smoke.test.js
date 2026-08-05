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
    // The rooms-and-corridors floor is 34 units half-size (layout.js);
    // geometry outside the shadow camera's box stops casting with no error,
    // so this guards the extent (R12).
    expect(sun.shadow.camera.right).toBeGreaterThanOrEqual(34);
    expect(sun.shadow.camera.top).toBeGreaterThanOrEqual(34);
    expect(sun.shadow.camera.far).toBeGreaterThan(sun.position.length());
  });

  it('keeps fog clear of hunt-and-ambush engagement range so bots stay readable', () => {
    const { scene } = createScene();

    // R10: engagements in the new map tend to start at closer range than
    // the old open arena's. Fog closing in before that would hide targets
    // at exactly the range they matter most (R15); the precise distance is
    // a U6 live-play retuning surface, not fixed here.
    expect(scene.fog.near).toBeGreaterThanOrEqual(15);
  });
});
