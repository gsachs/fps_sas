import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCharacterMesh, computeBotMeshYaw, computeBotMeshY, computeCameraYaw } from '../../src/render/entityMesh.js';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '../../src/sim/movement.js';

describe('createCharacterMesh', () => {
  // Regression: this placeholder is not just a brief loading flicker -- per
  // main.js, it's the permanent bot visual whenever the real GLTF model
  // fails to load (R9's error path). A hardcoded radius/height here can
  // silently drift from the actual physics capsule (as it did once: the
  // capsule widened 0.3 -> 0.4 but this geometry stayed at 0.3), leaving a
  // visible character narrower than its real hitbox on that fallback path.
  it('tracks the sim capsule dimensions instead of a hardcoded literal', () => {
    const { geometry } = createCharacterMesh();
    expect(geometry.parameters.radius).toBeCloseTo(CAPSULE_RADIUS);
    expect(geometry.parameters.height).toBeCloseTo(CAPSULE_HALF_HEIGHT * 2);
  });
});

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

describe('computeCameraYaw', () => {
  it('adds a half-turn to the sim yaw', () => {
    expect(computeCameraYaw(0)).toBeCloseTo(Math.PI);
    expect(computeCameraYaw(0.5)).toBeCloseTo(0.5 + Math.PI);
  });

  // Regression: this exact correction shipped once, was missing, and every
  // shot the player aimed by moving the mouse fired 180 degrees away from
  // what was on screen. Rather than only re-checking the +Math.PI
  // arithmetic (which a future "simplify away the redundant +PI" edit
  // could still break at the call site), this constructs a real
  // THREE.Camera the same way main.js's render loop does and confirms its
  // actual world-facing direction matches weapon.js's independently
  // authored hitscan-direction formula (sin(yaw)*cos(pitch), sin(pitch),
  // cos(yaw)*cos(pitch)) for a representative grid of yaw/pitch values.
  it('makes the camera face the same world direction the hitscan ray fires along', () => {
    const camera = new THREE.PerspectiveCamera();
    const worldDirection = new THREE.Vector3();

    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -Math.PI / 2, 2.4]) {
      for (const pitch of [0, 0.3, -0.4]) {
        camera.rotation.set(pitch, computeCameraYaw(yaw), 0, 'YXZ');
        camera.getWorldDirection(worldDirection);

        const hitscanDirection = {
          x: Math.sin(yaw) * Math.cos(pitch),
          y: Math.sin(pitch),
          z: Math.cos(yaw) * Math.cos(pitch),
        };

        expect(worldDirection.x).toBeCloseTo(hitscanDirection.x, 5);
        expect(worldDirection.y).toBeCloseTo(hitscanDirection.y, 5);
        expect(worldDirection.z).toBeCloseTo(hitscanDirection.z, 5);
      }
    }
  });
});
