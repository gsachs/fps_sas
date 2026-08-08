import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const loadCharacterModel = vi.fn();
vi.mock('../../src/render/models.js', () => ({
  loadCharacterModel: (...args) => loadCharacterModel(...args),
  loadPropModel: vi.fn(),
  disposeObject3D: vi.fn(),
}));

const { createCorpseField } = await import('../../src/render/corpses.js');

const MODEL = { scale: 1, clips: { idle: 'i', moving: 'm', dead: 'd', fire: 'f' }, yawOffset: 0, yOffset: -0.9 };

// A rig stand-in with the one clip the death pose needs. Fresh each call, the
// way models.js hands out a fresh SkeletonUtils clone per request.
function rig() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  return { scene, animations: [new THREE.AnimationClip('d', 1, [])], loaded: true };
}

const bodies = (scene) => scene.children.filter((child) => child.name === 'corpse');

function field(scene) {
  return createCorpseField(scene, { modelUrl: 'bot.glb', model: MODEL, onError: () => {} });
}

async function flush() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

afterEach(() => loadCharacterModel.mockReset());

describe('corpse field', () => {
  it('leaves a body at the position and facing it was given', async () => {
    loadCharacterModel.mockImplementation(async () => rig());
    const scene = new THREE.Scene();

    field(scene).spawn({ position: { x: 3, y: 1, z: -4 }, yaw: 1.2 });
    await flush();

    const [body] = bodies(scene);
    expect(body.position.x).toBe(3);
    expect(body.position.z).toBe(-4);
    // The rig has a feet-based origin, so the body sits a capsule lower than
    // the entity position -- without it, it lies in mid-air.
    expect(body.position.y).toBeCloseTo(1 + MODEL.yOffset, 6);
    expect(body.rotation.y).toBeCloseTo(1.2, 6);
  });

  it('adds no collider, so bullets and bot sight pass through', async () => {
    loadCharacterModel.mockImplementation(async () => rig());
    const scene = new THREE.Scene();

    field(scene).spawn({ position: { x: 0, y: 1, z: 0 }, yaw: 0 });
    await flush();

    // Cosmetic by construction: hitscans and line-of-sight both resolve
    // against Rapier, and this touches only the THREE scene graph. Asserted
    // so "make bodies solid" cannot happen by accident rather than by choice.
    expect(bodies(scene)).toHaveLength(1);
    expect(scene.children.every((child) => child.isObject3D)).toBe(true);
  });

  it('caps the field, dropping the oldest body first', async () => {
    loadCharacterModel.mockImplementation(async () => rig());
    const scene = new THREE.Scene();
    const corpses = field(scene);

    for (let i = 0; i < 40; i += 1) {
      corpses.spawn({ position: { x: i, y: 1, z: 0 }, yaw: 0 });
      await flush();
    }

    const remaining = bodies(scene);
    expect(remaining.length).toBeLessThan(40);
    expect(remaining.length).toBe(corpses.count());
    // Oldest first: the survivors are the most recent kills.
    const xs = remaining.map((body) => body.position.x);
    expect(Math.min(...xs)).toBe(40 - remaining.length);
  });

  it('clears every body on a match reset', async () => {
    loadCharacterModel.mockImplementation(async () => rig());
    const scene = new THREE.Scene();
    const corpses = field(scene);

    corpses.spawn({ position: { x: 0, y: 1, z: 0 }, yaw: 0 });
    corpses.spawn({ position: { x: 1, y: 1, z: 0 }, yaw: 0 });
    await flush();
    corpses.resetAll();

    expect(bodies(scene)).toHaveLength(0);
    expect(corpses.count()).toBe(0);
  });

  it('leaves no body when the rig fails to load, and does not throw', async () => {
    loadCharacterModel.mockImplementation(async () => ({ scene: null, animations: [], loaded: false }));
    const scene = new THREE.Scene();
    const corpses = field(scene);

    corpses.spawn({ position: { x: 0, y: 1, z: 0 }, yaw: 0 });
    await flush();

    expect(bodies(scene)).toHaveLength(0);
    expect(() => corpses.update(1 / 60)).not.toThrow();
  });
});
