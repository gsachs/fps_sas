import * as THREE from 'three';
import { raceInitWithTimeout } from '../shell/initTimeout.js';

// The scene and its lighting rig. What makes an arena of untextured boxes
// read as a place is not the geometry -- it is whether objects are grounded
// by shadow and lit by something with a direction. This file owns that half;
// tone mapping and shadow-map settings live on the renderer in main.js.

// Sky and horizon haze share a colour so distant geometry dissolves into the
// sky rather than ending at a visible line. U5/KTD5: resampled from the
// shipped sky texture's horizon band (modelAssets.js's SKY_TEXTURE_PATH) --
// the average colour of the middle 20-pixel band (rows 502-522 of the
// shipped 2048x1024 equirect JPEG; an equirectangular photo's vertical
// centre is always the horizon) computed once, offline, when the asset was
// sourced. Re-sample this by hand if the sky asset ever changes -- a stale
// constant here is exactly what reintroduces the seam KTD5 exists to avoid,
// since loadSkyBackground below never touches this value itself.
export const SKY_COLOR = 0x979baa;
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

  // Returned (not just added to the scene) so main.js can enable them on
  // weaponView.js's WEAPON_LAYER too, the same technique KTD4 already uses
  // for the muzzle light -- without it the viewmodel sits on a layer these
  // two lights never reach (their own .layers default to layer 0 only) and
  // renders as a flat, unlit silhouette between shots. Purely additive: it
  // adds layer-1 visibility to lights whose intensity, colour, position, and
  // shadow behaviour on the world (layer 0) are untouched, so R10's "the
  // lighting rig is untouched" holds -- nothing about the rig itself changes.
  return { scene, camera, sun, skyAmbient };
}

// U5/KTD5: loads the calm-horizon sky texture and swaps it in as
// scene.background once ready. Until then -- and forever, if the load fails
// or times out -- scene.background stays the flat SKY_COLOR createScene
// already set, which is deliberately the same colour as the texture's own
// horizon band: a stalled or failed load is invisible rather than reverting
// to a visibly different placeholder colour. THREE's equirectangular
// background mapping ignores scene.fog by design (the reason a flat colour
// was ever seamless in the first place, per the module comment above);
// EquirectangularReflectionMapping plus sRGB colour space are what make a
// plain photo-sourced JPEG behave as a background instead of a stretched,
// wrong-gamma flat image. Never rejects and never resolves null (Core
// Invariant) -- mirrors textures.js's loadSurfaceTexture contract.
//
// Deliberately not called from createScene itself: URL resolution for every
// other loaded asset (BOT_MODEL, WEAPON_MODEL, GUNSHOT_PATHS) already lives
// in main.js's own `assetUrl` helper, and createScene has no renderer/DOM
// dependency today -- adding one here would duplicate that helper instead of
// reusing it. main.js calls this once scene/camera exist, the same shape as
// the pistol model's own load-and-wire call.
export function loadSkyBackground(scene, url, { onError } = {}) {
  const loader = new THREE.TextureLoader();
  return raceInitWithTimeout(
    () => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
  )
    .then((texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
      return { loaded: true };
    })
    .catch((error) => {
      onError?.(error);
      return { loaded: false };
    });
}
