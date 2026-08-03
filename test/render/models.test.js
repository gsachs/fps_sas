import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../../src/render/models.js';

describe('disposeObject3D', () => {
  it('disposes geometry and material on every mesh in the hierarchy', () => {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');

    disposeObject3D(group);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes any texture referenced by a material', () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);

    const textureDispose = vi.spyOn(texture, 'dispose');

    disposeObject3D(mesh);

    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it('handles an array of materials (multi-material mesh)', () => {
    const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials);
    const disposeSpies = materials.map((m) => vi.spyOn(m, 'dispose'));

    disposeObject3D(mesh);

    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a node with no geometry or material (e.g. a Group)', () => {
    const group = new THREE.Group();
    group.add(new THREE.Group());
    expect(() => disposeObject3D(group)).not.toThrow();
  });
});
