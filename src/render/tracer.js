import * as THREE from 'three';

// Hitscan shots resolve instantly (KTD3) -- with no travelling projectile,
// a shot is otherwise invisible except for its effect on health. A tracer
// is a brief world-space beam standing in for the shot's path, for every
// shooter (local player and bots alike), not just the local weapon view.
//
// This is a Mesh rather than a THREE.Line because line width is the one
// thing a tracer needs and the one thing lines cannot give: the WebGL
// renderer ignores LineBasicMaterial.linewidth on every platform except a
// few Linux drivers, so a Line renders one pixel wide no matter what it is
// asked for. At arena range that is a hairline visible for a couple of
// frames -- the reason shots read as invisible. A camera-agnostic cylinder
// costs one draw call and can actually be seen.
const TRACER_LIFETIME_SECONDS = 0.14;
const TRACER_COLOR = 0xfff2b0;
const TRACER_RADIUS = 0.022;

// Unit cylinder shared by every tracer, translated so its origin sits at the
// base and scaling along Y grows it from the muzzle toward the impact. Shared
// because tracers spawn ~10x/second per shooter: allocating geometry per shot
// is what makes renderer.info.memory climb instead of plateau over a match.
const BEAM_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
BEAM_GEOMETRY.translate(0, 0.5, 0);
const BEAM_AXIS = new THREE.Vector3(0, 1, 0);

export function createTracerSystem(scene) {
  const active = [];

  function spawn(origin, endPoint) {
    const start = new THREE.Vector3(origin.x, origin.y, origin.z);
    const direction = new THREE.Vector3(endPoint.x, endPoint.y, endPoint.z).sub(start);
    const length = direction.length();
    // A zero-length shot has no direction to orient against, and normalising
    // it would produce a NaN quaternion that silently corrupts the mesh.
    if (length === 0) return;

    const material = new THREE.MeshBasicMaterial({
      color: TRACER_COLOR,
      transparent: true,
      // Tracers are glow, not geometry: writing depth makes them occlude the
      // impact spark spawned at the same instant at their own far end.
      depthWrite: false,
    });
    const beam = new THREE.Mesh(BEAM_GEOMETRY, material);
    beam.position.copy(start);
    beam.quaternion.setFromUnitVectors(BEAM_AXIS, direction.divideScalar(length));
    beam.scale.set(TRACER_RADIUS, length, TRACER_RADIUS);
    scene.add(beam);
    active.push({ beam, remaining: TRACER_LIFETIME_SECONDS });
  }

  function update(deltaSeconds) {
    for (let i = active.length - 1; i >= 0; i--) {
      const entry = active[i];
      entry.remaining -= deltaSeconds;
      if (entry.remaining <= 0) {
        scene.remove(entry.beam);
        // Material only -- BEAM_GEOMETRY is shared by every tracer alive or
        // yet to spawn, so disposing it here would blank all of them.
        entry.beam.material.dispose();
        active.splice(i, 1);
        continue;
      }
      entry.beam.material.opacity = entry.remaining / TRACER_LIFETIME_SECONDS;
    }
  }

  return { spawn, update };
}
