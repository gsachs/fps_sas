// The thing that brought the bot. An arrival already falls from fourteen
// units up (health.js's airdrop), but with nothing overhead it still read as
// a body appearing in the sky rather than as being delivered. This puts a
// drone at the release point and flies it off, which is what makes the drop
// legible as a drop.
//
// Purely cosmetic, unlike the descent itself. The falling bot has to be
// simulation because it can be shot; the drone cannot be shot, interacts
// with nothing, and exists only between the release and leaving frame, so it
// lives entirely in the render layer with no collider and no sim state.
//
// Built from primitives rather than loaded: nothing in the asset set flies,
// and a quadcopter is four rotors on a box -- cheaper to build than to
// source, attribute and load, and it matches the low-poly rigs already here.
import * as THREE from 'three';

// Sized against the thing it carries: a bot is 1.8 units tall, so a machine
// big enough to be lifting one wants a span comfortably wider than that.
// This works out around 4 units across, which is also about the smallest
// that still reads as a quadcopter rather than a speck from fourteen units
// below -- which is the only angle it is ever seen from.
const BODY_SIZE = { x: 1.4, y: 0.36, z: 1.4 };
const BOOM_LENGTH = 1.4;
const BOOM_THICKNESS = 0.16;
const ROTOR_RADIUS = 0.6;
const ROTOR_SPIN_RATE = 34; // radians/sec -- fast enough to blur into a disc

const BODY_COLOR = 0x2f343d;
const ROTOR_COLOR = 0x9aa3ad;

// Sits above the release point: the bot hangs underneath, so the drone has
// to clear the space the bot occupies at the top of its fall, and for the
// local player -- who also arrives this way -- it keeps the drone out of
// the camera rather than wrapped around it.
const RELEASE_CLEARANCE = 2.2;

// Holds station while the bot drops clear, then leaves. The bot's own fall
// takes about 0.8s, so this reads as "released, waited, peeled off" rather
// than the drone bolting the instant it appears.
const HOVER_SECONDS = 0.55;
const DEPART_SPEED = 26; // units/sec at full throttle
const DEPART_CLIMB = 0.35; // fraction of that speed spent gaining height
const SPIN_UP_SECONDS = 0.7; // eased rather than instant, so it accelerates away
const LIFETIME_SECONDS = 3.4;
const FADE_SECONDS = 0.8; // trailing fade, so it thins out instead of popping

// Several drops can overlap on a busy ramp; past a handful they are all off
// over the wall anyway.
const MAX_ACTIVE = 6;

// One shared set of geometries -- a drone spawns per arrival, and per-drone
// geometry is what makes renderer.info.memory climb over a match instead of
// plateauing (the same reason tracers and impacts share theirs).
const BODY_GEOMETRY = new THREE.BoxGeometry(BODY_SIZE.x, BODY_SIZE.y, BODY_SIZE.z);
const BOOM_GEOMETRY = new THREE.BoxGeometry(BOOM_THICKNESS, BOOM_THICKNESS * 0.6, BOOM_LENGTH);
const ROTOR_GEOMETRY = new THREE.CylinderGeometry(ROTOR_RADIUS, ROTOR_RADIUS, 0.04, 12);

// Booms and rotors go to the four diagonals, so the silhouette reads as a
// quadcopter from directly below -- which is the angle it is almost always
// seen from.
const ROTOR_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

function buildDrone() {
  const drone = new THREE.Group();
  drone.name = 'dropship';
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.6, transparent: true });
  const rotorMaterial = new THREE.MeshStandardMaterial({ color: ROTOR_COLOR, roughness: 0.4, transparent: true });

  const body = new THREE.Mesh(BODY_GEOMETRY, bodyMaterial);
  body.castShadow = true;
  drone.add(body);

  const rotors = [];
  for (const angle of ROTOR_ANGLES) {
    const [dx, dz] = [Math.cos(angle), Math.sin(angle)];

    const boom = new THREE.Mesh(BOOM_GEOMETRY, bodyMaterial);
    boom.position.set((dx * BOOM_LENGTH) / 2, 0, (dz * BOOM_LENGTH) / 2);
    boom.rotation.y = -angle; // point the boom's long axis down the diagonal
    boom.castShadow = true;
    drone.add(boom);

    const rotor = new THREE.Mesh(ROTOR_GEOMETRY, rotorMaterial);
    rotor.position.set(dx * BOOM_LENGTH, BODY_SIZE.y / 2, dz * BOOM_LENGTH);
    drone.add(rotor);
    rotors.push(rotor);
  }

  return { drone, rotors, materials: [bodyMaterial, rotorMaterial] };
}

// Away from the arena's middle, so a drone always leaves over the nearest
// stretch of wall rather than across the map. Deterministic from the release
// point: two drops at the same spot leave the same way, which reads as a
// flight path rather than as noise.
function departureDirection(position) {
  const length = Math.hypot(position.x, position.z);
  if (length < 1e-6) return { x: 1, z: 0 };
  return { x: position.x / length, z: position.z / length };
}

export function createDropshipFleet(scene) {
  const active = [];
  // Which entities were mid-arrival last frame, so a drop is spawned once on
  // the transition rather than every frame of the fall.
  let arrivingIds = new Set();

  function retire(index) {
    const [entry] = active.splice(index, 1);
    scene.remove(entry.drone);
    for (const material of entry.materials) material.dispose(); // geometries are shared
  }

  function spawn(releasePoint) {
    if (active.length >= MAX_ACTIVE) retire(0);
    const { drone, rotors, materials } = buildDrone();
    drone.position.set(releasePoint.x, releasePoint.y + RELEASE_CLEARANCE, releasePoint.z);
    const heading = departureDirection(releasePoint);
    // Nose into the direction of travel, so it banks away rather than
    // sliding off sideways.
    drone.rotation.y = Math.atan2(heading.x, heading.z);
    scene.add(drone);
    active.push({ drone, rotors, materials, heading, elapsed: 0 });
  }

  // Spawns a drone for every entity that has just started arriving. Takes the
  // live entity list and diffs it against last frame, the same shape
  // grenadeFX.syncInFlight uses -- there is no 'airdrop started' event, and
  // deriving it here keeps the sim from growing one for a purely visual
  // effect.
  function syncArrivals(entities) {
    const stillArriving = new Set();
    for (const entity of entities) {
      if (!entity.airdropping) continue;
      stillArriving.add(entity.id);
      if (!arrivingIds.has(entity.id)) spawn(entity.position);
    }
    arrivingIds = stillArriving;
  }

  function update(deltaSeconds) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const entry = active[i];
      entry.elapsed += deltaSeconds;
      if (entry.elapsed >= LIFETIME_SECONDS) {
        retire(i);
        continue;
      }

      for (const rotor of entry.rotors) rotor.rotation.y += ROTOR_SPIN_RATE * deltaSeconds;

      // Station-keeping, then an eased run-up to full speed, so the drone
      // pulls away rather than teleporting into motion.
      const departing = entry.elapsed - HOVER_SECONDS;
      if (departing > 0) {
        const throttle = Math.min(1, departing / SPIN_UP_SECONDS);
        const step = DEPART_SPEED * throttle * deltaSeconds;
        entry.drone.position.x += entry.heading.x * step;
        entry.drone.position.z += entry.heading.z * step;
        entry.drone.position.y += DEPART_CLIMB * step;
      }

      const remaining = LIFETIME_SECONDS - entry.elapsed;
      if (remaining < FADE_SECONDS) {
        const opacity = remaining / FADE_SECONDS;
        for (const material of entry.materials) material.opacity = opacity;
      }
    }
  }

  function resetAll() {
    for (let i = active.length - 1; i >= 0; i -= 1) retire(i);
    arrivingIds = new Set();
  }

  return { syncArrivals, update, resetAll, count: () => active.length };
}
