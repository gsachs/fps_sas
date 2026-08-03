import * as THREE from 'three';

export function createScene({ aspect = 16 / 9 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a8c9);
  scene.fog = new THREE.Fog(0x87a8c9, 25, 60);

  const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

  const ambient = new THREE.AmbientLight(0xffffff, 1.1);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(10, 15, 8);
  scene.add(sun);

  return { scene, camera };
}
