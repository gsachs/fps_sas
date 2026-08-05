import * as THREE from 'three';

// The scene and its lighting rig. What makes an arena of untextured boxes
// read as a place is not the geometry -- it is whether objects are grounded
// by shadow and lit by something with a direction. This file owns that half;
// tone mapping and shadow-map settings live on the renderer in main.js.

// Sky and horizon haze share a colour so distant geometry dissolves into the
// sky rather than ending at a visible line.
const SKY_COLOR = 0xa8bed6;
// Retuned for the rooms-and-corridors map (KTD8): walls cap real sightlines
// far short of the old open arena's ~85-unit diagonal -- the longest is a
// ~36-unit loop corridor or a ~30-unit corridor-through-spoke line into the
// central room. Fog starts near that range and reaches full density with
// margin past it, so it actually contributes instead of sitting unused
// beyond where any line of sight can reach. Close fog would hide bots at
// exactly the range where the player most needs to pick them out (R15).
const FOG_NEAR = 20;
const FOG_FAR = 60;

const SUN_COLOR = 0xfff2df;
const SUN_INTENSITY = 2.6;
// High and off to one side: a sun near the zenith casts shadows directly
// under objects, where they are invisible from standing eye height, and the
// grounding they provide is the entire point.
const SUN_POSITION = { x: 18, y: 26, z: 12 };

// Sky-based ambient rather than a single flat term: surfaces facing up catch
// sky light and surfaces facing down catch bounce off the ground, so a box
// has visibly different faces even where the sun does not reach it.
const SKY_AMBIENT_COLOR = 0xbcd6f2;
const GROUND_BOUNCE_COLOR = 0x55503f;
const AMBIENT_INTENSITY = 1.4;

// The shadow camera is an orthographic box that must contain everything
// meant to cast a shadow; anything outside it silently stops casting. Sized
// to the rooms-and-corridors map's floor (half-size 34, layout.js) with
// margin for outermost wall thickness.
const SHADOW_EXTENT = 36;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_CAMERA_NEAR = 1;
const SHADOW_CAMERA_FAR = 90;
// Depth-comparison offsets that keep a surface from shadowing itself. Without
// them a lit floor is covered in acne; too much and shadows detach from the
// object casting them (peter-panning).
const SHADOW_BIAS = -0.0006;
const SHADOW_NORMAL_BIAS = 0.03;

export function createScene({ aspect = 16 / 9 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
  // Cameras have no visible geometry of their own; adding it to the scene
  // graph exists so objects parented to it later (U7's first-person weapon
  // view) are included when the renderer traverses the scene -- a child of
  // an unparented camera would never be visited otherwise.
  scene.add(camera);

  const skyAmbient = new THREE.HemisphereLight(
    SKY_AMBIENT_COLOR,
    GROUND_BOUNCE_COLOR,
    AMBIENT_INTENSITY
  );
  scene.add(skyAmbient);

  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.position.set(SUN_POSITION.x, SUN_POSITION.y, SUN_POSITION.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = SHADOW_CAMERA_NEAR;
  sun.shadow.camera.far = SHADOW_CAMERA_FAR;
  sun.shadow.bias = SHADOW_BIAS;
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
  scene.add(sun);

  return { scene, camera };
}
