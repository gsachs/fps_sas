import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BOT_MODEL,
  WEAPON_MODEL,
  MACHINEGUN_MODEL,
  ARENA_SURFACE_TEXTURE,
  SKY_TEXTURE_PATH,
} from '../../src/render/modelAssets.js';

// These assertions run against the actual shipped .glb files, not fixtures.
// A model swap that breaks any of them fails silently in the browser -- a
// mismatched clip name leaves the bot frozen in its bind pose, and a skinned
// weapon renders at the wrong scale no matter what transform it is given --
// so the binary is the only thing worth testing against.
const loader = new GLTFLoader();

function loadShipped(assetPath) {
  const url = new URL(`../../public/${assetPath}`, import.meta.url);
  const buffer = fs.readFileSync(fileURLToPath(url));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));
}

describe('BOT_MODEL', () => {
  it('names a clip that exists in the shipped rig for every animation hint', async () => {
    const gltf = await loadShipped(BOT_MODEL.path);
    const available = gltf.animations.map((clip) => clip.name);

    for (const [hint, clipName] of Object.entries(BOT_MODEL.clips)) {
      expect(available, `hint "${hint}" maps to a missing clip`).toContain(clipName);
    }
  });

  it('covers every hint the simulation can emit, plus the fire reaction', () => {
    expect(Object.keys(BOT_MODEL.clips).sort()).toEqual(['dead', 'fire', 'idle', 'moving']);
  });

  it('scales the rig to roughly the height of the simulation capsule', async () => {
    const gltf = await loadShipped(BOT_MODEL.path);
    gltf.scene.updateMatrixWorld(true);
    const nativeHeight = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;

    // The capsule is 1.8 tall; a rig within ~25% of that reads as the right
    // size. A swapped asset with a different native height fails here rather
    // than shipping a giant or a doll.
    expect(nativeHeight * BOT_MODEL.scale).toBeGreaterThan(1.35);
    expect(nativeHeight * BOT_MODEL.scale).toBeLessThan(2.25);
  });
});

describe('WEAPON_MODEL', () => {
  it('points at a static model, since the prop loader cannot clone a skinned one', async () => {
    const gltf = await loadShipped(WEAPON_MODEL.path);
    const skinned = [];
    gltf.scene.traverse((node) => {
      if (node.isSkinnedMesh) skinned.push(node.name);
    });

    expect(skinned).toEqual([]);
  });

  it('scales the weapon to a viewmodel that fits in front of the camera', async () => {
    const gltf = await loadShipped(WEAPON_MODEL.path);
    gltf.scene.updateMatrixWorld(true);
    const nativeSize = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    const longestAxis = Math.max(nativeSize.x, nativeSize.y, nativeSize.z) * WEAPON_MODEL.scale;

    // The weapon group sits 0.5 units in front of the camera, so anything
    // approaching that length intersects the near plane and clips.
    expect(longestAxis).toBeLessThan(0.5);
    expect(longestAxis).toBeGreaterThan(0.1);
  });
});

describe('ARENA_SURFACE_TEXTURE', () => {
  it('points at a shipped JPEG texture file', () => {
    const url = new URL(`../../public/${ARENA_SURFACE_TEXTURE.colorPath}`, import.meta.url);
    const buffer = fs.readFileSync(fileURLToPath(url));

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])); // JPEG magic bytes
  });
});

// U5: replaces weaponView.js's placeholder box for MACHINEGUN_WEAPON_ID
// through setModel's existing seam. Same shape of guard as WEAPON_MODEL
// above, for the same reason -- a swap that breaks either check fails
// silently in the browser (bind-pose-frozen or wrong-scale weapon).
describe('MACHINEGUN_MODEL', () => {
  it('points at a static model, since the prop loader cannot clone a skinned one', async () => {
    const gltf = await loadShipped(MACHINEGUN_MODEL.path);
    const skinned = [];
    gltf.scene.traverse((node) => {
      if (node.isSkinnedMesh) skinned.push(node.name);
    });

    expect(skinned).toEqual([]);
  });

  it('scales the machine gun to roughly the placeholder box it replaces', async () => {
    const gltf = await loadShipped(MACHINEGUN_MODEL.path);
    gltf.scene.updateMatrixWorld(true);
    const nativeSize = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    const longestAxis = Math.max(nativeSize.x, nativeSize.y, nativeSize.z) * MACHINEGUN_MODEL.scale;

    // weaponView.js's MACHINEGUN_WEAPON_ID placeholder box is z: 0.55 --
    // deliberately longer than the pistol's, so the swap shouldn't shrink or
    // grow that on-screen size. +/-25% band, matching BOT_MODEL's own
    // scale-sanity margin above.
    expect(longestAxis).toBeGreaterThan(0.41);
    expect(longestAxis).toBeLessThan(0.69);
  });
});

describe('SKY_TEXTURE_PATH', () => {
  it('points at a shipped JPEG sky texture file', () => {
    const url = new URL(`../../public/${SKY_TEXTURE_PATH}`, import.meta.url);
    const buffer = fs.readFileSync(fileURLToPath(url));

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])); // JPEG magic bytes
  });
});
