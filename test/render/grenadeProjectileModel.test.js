// The in-flight grenade's placeholder-to-real-model swap. Split from
// grenadeFX.test.js because it has to mock the loader module, which that
// file's other cases must not have mocked out from under them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const loadPropModel = vi.fn();
vi.mock('../../src/render/models.js', () => ({
  loadPropModel: (...args) => loadPropModel(...args),
  disposeObject3D: vi.fn(),
}));

const { createGrenadeFX } = await import('../../src/render/grenadeFX.js');
const { GRENADE_PROJECTILE_MODEL } = await import('../../src/render/modelAssets.js');

const grenadeGroups = (scene) => scene.children.filter((child) => child.name === 'grenade');
const visualOf = (group) => group.children[0];

function fakeLoadedModel() {
  const model = new THREE.Group();
  model.name = 'loaded-grenade';
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return model;
}

afterEach(() => {
  loadPropModel.mockReset();
});

describe('in-flight grenade model swap', () => {
  it('shows a placeholder immediately, before the model has loaded', () => {
    loadPropModel.mockReturnValue(new Promise(() => {})); // never settles
    const scene = new THREE.Scene();

    createGrenadeFX(scene);

    // R18: a stalled load must not leave a thrown grenade invisible.
    for (const group of grenadeGroups(scene)) {
      expect(visualOf(group)).toBeDefined();
      expect(visualOf(group).name).not.toBe('loaded-grenade');
    }
  });

  it('replaces every pooled placeholder once the model arrives', async () => {
    loadPropModel.mockResolvedValue({ scene: fakeLoadedModel(), loaded: true });
    const scene = new THREE.Scene();

    createGrenadeFX(scene);
    await vi.waitFor(() => expect(visualOf(grenadeGroups(scene)[0]).name).toBe('loaded-grenade'));

    // Every slot, not just the first: they are all pre-seeded before the
    // load resolves.
    for (const group of grenadeGroups(scene)) {
      expect(visualOf(group).name).toBe('loaded-grenade');
    }
  });

  it('gives each slot its own clone, since two grenades can be airborne', async () => {
    loadPropModel.mockResolvedValue({ scene: fakeLoadedModel(), loaded: true });
    const scene = new THREE.Scene();

    createGrenadeFX(scene);
    await vi.waitFor(() => expect(visualOf(grenadeGroups(scene)[0]).name).toBe('loaded-grenade'));

    const visuals = grenadeGroups(scene).map(visualOf);
    expect(new Set(visuals).size).toBe(visuals.length);
  });

  it('never disposes an outgoing placeholder, whose geometry the pool shares', async () => {
    loadPropModel.mockResolvedValue({ scene: fakeLoadedModel(), loaded: true });
    const scene = new THREE.Scene();

    createGrenadeFX(scene);
    const placeholderGeometry = visualOf(grenadeGroups(scene)[0]).geometry;
    const disposed = vi.spyOn(placeholderGeometry, 'dispose');

    await vi.waitFor(() => expect(visualOf(grenadeGroups(scene)[0]).name).toBe('loaded-grenade'));

    // The placeholder's geometry and material are module-level singletons
    // shared by the whole pool, unlike pickupMeshes.js's per-pickup ones.
    // Disposing one on swap-out would blank every other placeholder -- and
    // any created later, since projectileVisual falls back to them whenever
    // the load has not landed.
    expect(disposed).not.toHaveBeenCalled();
  });

  it('keeps the placeholder when the model fails to load', async () => {
    loadPropModel.mockResolvedValue({ scene: null, loaded: false });
    const scene = new THREE.Scene();

    createGrenadeFX(scene);
    await Promise.resolve();
    await Promise.resolve();

    for (const group of grenadeGroups(scene)) {
      expect(visualOf(group)).toBeDefined();
      expect(visualOf(group).name).not.toBe('loaded-grenade');
    }
  });

  it('positions the group, leaving the model offset to the visual inside it', async () => {
    loadPropModel.mockResolvedValue({ scene: fakeLoadedModel(), loaded: true });
    const scene = new THREE.Scene();
    const fx = createGrenadeFX(scene);
    await vi.waitFor(() => expect(visualOf(grenadeGroups(scene)[0]).name).toBe('loaded-grenade'));

    fx.syncInFlight([{ id: 'g0', position: { x: 4, y: 2, z: -7 } }]);

    // The separation that lets the swap happen mid-flight without
    // syncInFlight knowing which visual is in there: the group tracks the
    // sim position, the visual carries the model's own recentring offset.
    const [group] = grenadeGroups(scene).filter((child) => child.visible);
    expect(group.position).toEqual(new THREE.Vector3(4, 2, -7));
    expect(visualOf(group).position.x).toBeCloseTo(GRENADE_PROJECTILE_MODEL.offset.x, 6);
    expect(visualOf(group).position.y).toBeCloseTo(GRENADE_PROJECTILE_MODEL.offset.y, 6);
  });
});
