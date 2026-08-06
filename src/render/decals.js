// Bullet marks on world surfaces (R5): without them, a shot into a wall and
// a shot into open air look identical, and a fight leaves no trace of where
// it happened. Placement is a render-layer concern (KTD2) -- the sim's own
// hitscan (castRay) never resolves a surface normal, so the visible surface
// and its normal are found here by raycasting the arena's own visual meshes
// along the fire event's already-resolved origin-to-endpoint segment. This
// mirrors the reasoning impacts.js documents for using a spark instead of a
// decal for its own transient flash.
import * as THREE from 'three';

const DECAL_SIZE = 0.28; // world units -- a bullet mark, not a poster
const DEFAULT_FORWARD = new THREE.Vector3(0, 0, 1); // PlaneGeometry's own resting normal
const SURFACE_OFFSET = 0.01; // lifts the quad off the surface it's stamped on, avoiding self-intersection
const DECAL_COLOR = 0x1c1a17; // dark scorch mark, reads on every accent colour this arena uses

// KTD3: the MG fires 30 rounds/sec, so per-round decals into roughly the
// same spot would be waste; a ~0.15-unit cluster counts as one mark.
const DEDUP_DISTANCE = 0.15;
const DEDUP_DISTANCE_SQ = DEDUP_DISTANCE * DEDUP_DISTANCE;

// KTD3: cap ~200 persistent decals; past that, the oldest fades out over a
// short ramp rather than popping away instantly.
const MAX_ACTIVE_DECALS = 200;
const EVICTION_FADE_SECONDS = 0.25;

// Shared across every decal the same way impacts.js's SPARK_GEOMETRY is --
// decals spawn as often as shots land, and per-decal geometry is what stops
// renderer.info.memory from plateauing over a long match.
const DECAL_GEOMETRY = new THREE.PlaneGeometry(DECAL_SIZE, DECAL_SIZE);

// Pure, so KTD7's directional sign test can exercise it without a scene,
// raycaster, or mesh. `normal` stays a plain {x,y,z} at this boundary
// (KTD7's rule for data crossing module boundaries) even though this module
// is free to use THREE internally past it. A PlaneGeometry's own resting
// orientation faces +Z, so the quaternion that carries +Z onto the given
// normal is exactly the rotation that makes the quad face out of the
// surface -- THREE.Quaternion.setFromUnitVectors is the verified primitive
// for that (it also has a defined answer for the antiparallel case, where a
// naive cross-product axis would be undefined), so this reuses it instead of
// hand-rolling the same "project relative to the normal" rigor
// steering.js's avoidObstacles already holds itself to.
export function computeDecalOrientation(normal) {
  const targetNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
  return new THREE.Quaternion().setFromUnitVectors(DEFAULT_FORWARD, targetNormal);
}

// A raycast hit's normal is in the hit mesh's local (object) space, not
// world space -- three.js's own DecalGeometry example helper transforms it
// the same way: the inverse-transpose of the mesh's world matrix (not a raw
// transformDirection), so a non-uniformly scaled surface still yields a
// correct normal. `intersection.normal` (rather than `intersection.face.normal`)
// is used because Mesh.raycast already flips it to face back toward the ray
// origin -- exactly "outward, toward the shooter" -- while face.normal is
// the raw, unflipped winding-order normal.
function worldNormalFromIntersection(intersection) {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld);
  return intersection.normal.clone().applyNormalMatrix(normalMatrix);
}

export function createDecalSystem(scene, arenaMeshes) {
  const active = []; // age-ordered, oldest first: { mesh, material }
  const retiring = []; // fading out after a cap-pressure eviction: { mesh, material, remaining }
  const raycaster = new THREE.Raycaster();

  function disposeEntry(entry) {
    scene.remove(entry.mesh);
    entry.material.dispose(); // geometry is shared; see DECAL_GEOMETRY
  }

  function findDedupIndex(position) {
    return active.findIndex((entry) => entry.mesh.position.distanceToSquared(position) <= DEDUP_DISTANCE_SQ);
  }

  function evictOldest() {
    const [oldest] = active.splice(0, 1);
    retiring.push({ ...oldest, remaining: EVICTION_FADE_SECONDS });
  }

  // Spawns (or dedups against) a decal at a world hit point with a world
  // surface normal -- both plain {x,y,z} at this boundary, promoted to THREE
  // types once inside. Exposed directly (not just via spawnFromFireEvent) so
  // the pool/dedup/cap math is testable without a scene graph to raycast
  // against.
  function spawn(point, normal) {
    const position = new THREE.Vector3(point.x, point.y, point.z);
    const dedupIndex = findDedupIndex(position);
    if (dedupIndex !== -1) {
      // Refresh, not a no-op: a spot under sustained fire should outlive a
      // spot hit once by chance, not get evicted first just because it
      // happened to be placed first -- bump it to the newest end of the
      // age-ordered array so eviction keeps passing it over.
      const [existing] = active.splice(dedupIndex, 1);
      active.push(existing);
      return;
    }

    if (active.length >= MAX_ACTIVE_DECALS) evictOldest();

    const material = new THREE.MeshBasicMaterial({
      color: DECAL_COLOR,
      transparent: true,
      depthWrite: false,
      // Negative offset pulls the decal's fragment depth toward the camera
      // (WebGLState.setPolygonOffset feeds this straight into
      // gl.polygonOffset(factor, units), where a positive value pushes a
      // fragment away from the camera) -- without it the decal and the
      // coplanar surface it sits on would z-fight at render time.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(DECAL_GEOMETRY, material);
    mesh.name = 'decal';
    mesh.quaternion.copy(computeDecalOrientation(normal));
    const unitNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    mesh.position.copy(position).addScaledVector(unitNormal, SURFACE_OFFSET);
    scene.add(mesh);
    active.push({ mesh, material });
  }

  // KTD2: raycasts the fire segment against the arena's visual meshes only
  // (never the whole scene, which would also catch bots, the viewmodel,
  // tracers, and decals themselves) -- `raycaster.far` is clamped to the
  // segment's own length so a hit past the sim's already-resolved endpoint
  // is never reported. Skips silently, spawning nothing, when the segment
  // hits nothing within that distance -- which is what a max-range total
  // miss looks like from here, with no special-case detection needed.
  function spawnFromFireEvent(origin, endPoint) {
    const from = new THREE.Vector3(origin.x, origin.y, origin.z);
    const to = new THREE.Vector3(endPoint.x, endPoint.y, endPoint.z);
    const offset = to.sub(from);
    const distance = offset.length();
    if (distance < 1e-6) return; // origin === endPoint: no segment to raycast

    raycaster.set(from, offset.divideScalar(distance));
    raycaster.far = distance;
    const [hit] = raycaster.intersectObject(arenaMeshes, true);
    if (!hit) return;

    spawn(hit.point, worldNormalFromIntersection(hit));
  }

  // Most decals are static once placed -- only entries currently fading out
  // after a cap-pressure eviction need per-frame work.
  function update(deltaSeconds) {
    for (let i = retiring.length - 1; i >= 0; i--) {
      const entry = retiring[i];
      entry.remaining -= deltaSeconds;
      if (entry.remaining <= 0) {
        disposeEntry(entry);
        retiring.splice(i, 1);
        continue;
      }
      entry.material.opacity = entry.remaining / EVICTION_FADE_SECONDS;
    }
  }

  function resetAll() {
    for (const entry of active) disposeEntry(entry);
    for (const entry of retiring) disposeEntry(entry);
    active.length = 0;
    retiring.length = 0;
  }

  return { spawn, spawnFromFireEvent, update, resetAll };
}
