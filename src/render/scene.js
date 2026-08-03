import * as THREE from 'three';

export function createScene({ aspect = 16 / 9 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d24);

  const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
  camera.position.set(0, 1.7, 5);
  camera.lookAt(0, 0.5, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(10, 15, 8);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a3f4a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  scene.add(ground);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xcc4444 })
  );
  box.position.set(0, 0.5, 0);
  box.name = 'placeholder-box';
  scene.add(box);

  return { scene, camera };
}
