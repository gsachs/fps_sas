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
// How far down the shot the beam actually starts. The local player's fire
// origin is the camera itself, so a beam drawn from the origin puts a
// cylinder centimetres from the eye: at that range even a 2cm-wide tracer
// covers a third of the screen, which is the pale band that swamped the view
// on every shot. Starting it clear of the near field leaves the muzzle flash
// to sell the shot leaving the gun, and the beam to sell where it went. Bots
// are unaffected in practice -- at any range you can see one from, two
// metres off their muzzle is not a visible difference.
export const TRACER_START_OFFSET = 2;

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
    const fullLength = direction.length();
    // A zero-length shot has no direction to orient against, and normalising
    // it would produce a NaN quaternion that silently corrupts the mesh.
    if (fullLength === 0) return;
    // A shot that lands inside the offset -- point blank against a wall or a
    // body -- gets no beam at all. There is no room to draw one that would
    // not be the near-eye band this offset exists to remove, and the muzzle
    // flash and impact spark already cover that range.
    const length = fullLength - TRACER_START_OFFSET;
    if (length <= 0) return;
    direction.divideScalar(fullLength);
    start.addScaledVector(direction, TRACER_START_OFFSET);

    const material = new THREE.MeshBasicMaterial({
      color: TRACER_COLOR,
      transparent: true,
      // Tracers are glow, not geometry: writing depth makes them occlude the
      // impact spark spawned at the same instant at their own far end.
      depthWrite: false,
    });
    const beam = new THREE.Mesh(BEAM_GEOMETRY, material);
    beam.name = 'tracer';
    beam.position.copy(start);
    beam.quaternion.setFromUnitVectors(BEAM_AXIS, direction);
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
