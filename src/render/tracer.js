import * as THREE from 'three';

// Hitscan shots resolve instantly (KTD3) -- with no travelling projectile,
// a shot is otherwise invisible except for its effect on health. A tracer
// is a brief world-space line standing in for the shot's path, for every
// shooter (local player and bots alike), not just the local weapon view.
const TRACER_LIFETIME_SECONDS = 0.08;
const TRACER_COLOR = 0xfff2b0;

export function createTracerSystem(scene) {
  const active = [];

  function spawn(origin, endPoint) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(origin.x, origin.y, origin.z),
      new THREE.Vector3(endPoint.x, endPoint.y, endPoint.z),
    ]);
    const material = new THREE.LineBasicMaterial({ color: TRACER_COLOR, transparent: true });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    active.push({ line, remaining: TRACER_LIFETIME_SECONDS });
  }

  function update(deltaSeconds) {
    for (let i = active.length - 1; i >= 0; i--) {
      const entry = active[i];
      entry.remaining -= deltaSeconds;
      if (entry.remaining <= 0) {
        scene.remove(entry.line);
        entry.line.geometry.dispose();
        entry.line.material.dispose();
        active.splice(i, 1);
        continue;
      }
      entry.line.material.opacity = entry.remaining / TRACER_LIFETIME_SECONDS;
    }
  }

  return { spawn, update };
}
