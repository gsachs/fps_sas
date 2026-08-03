import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOT_MODEL, WEAPON_MODEL } from '../../src/render/modelAssets.js';

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
