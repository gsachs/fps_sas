import * as THREE from 'three';
import { raceInitWithTimeout } from '../shell/initTimeout.js';
import { FLOOR_HALF_SIZE } from '../arena/layout.js';
import { DEFAULT_SHADOW_QUALITY, shadowMapSize } from '../shell/graphicsSettings.js';

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
// Fog is tuned against the longest line of sight the geometry actually
// produces, never against the floor's size: walls cap real sightlines far
// short of the floor diagonal, and fog placed past where any line of sight
// can reach simply does not contribute. Close fog is worse than none -- it
// hides bots at exactly the range where the player most needs to pick them
// out (R15).
//
// Measured, not estimated: ray-marching the live layout at eye height gives
// a longest unobstructed line of 62 units, from the Yard's west edge east
// along the west spoke and through the Landmark. Half of every standing
// position's own longest line is under 26. test/render/fogRange.test.js
// re-measures against the live layout and fails when the map drifts away
// from this, which is the guard the shadow extent twice went without.
const LONGEST_SIGHTLINE = 62;
// The retired arena's hand-tuned 20/60 pair held these proportions against
// its own ~36-unit longest line. Carrying the proportions rather than
// re-guessing the distances keeps the look the author already accepted:
// fog opens a little past half the longest line, and saturates comfortably
// beyond its end so the far wall of the longest sightline is heavily
// tinted but never solid.
const FOG_START_FRACTION = 0.56;
const FOG_SATURATION_FRACTION = 1.67;
const FOG_NEAR = Math.round(LONGEST_SIGHTLINE * FOG_START_FRACTION); // 35
const FOG_FAR = Math.round(LONGEST_SIGHTLINE * FOG_SATURATION_FRACTION); // 104

export const FOG_RANGE = { near: FOG_NEAR, far: FOG_FAR, longestSightline: LONGEST_SIGHTLINE };

const SUN_COLOR = 0xfff2df;
const SUN_INTENSITY = 2.6;
// High and off to one side: a sun near the zenith casts shadows directly
// under objects, where they are invisible from standing eye height, and the
// grounding they provide is the entire point.
const SUN_DIRECTION = { x: 18, y: 26, z: 12 };

// Sky-based ambient rather than a single flat term: surfaces facing up catch
// sky light and surfaces facing down catch bounce off the ground, so a box
// has visibly different faces even where the sun does not reach it.
const SKY_AMBIENT_COLOR = 0xbcd6f2;
const GROUND_BOUNCE_COLOR = 0x55503f;
const AMBIENT_INTENSITY = 1.4;

// The shadow camera is an orthographic box that must contain everything
// meant to cast a shadow; anything outside it silently stops casting --
// invisibly, since a wall or pillar outside the box still renders, it just
// stops grounding itself with a shadow, reading as floating with light
// leaking under it. Derived from the live floor scalar (KTD1), not a
// hand-copied number, so a future arena resize can never let this drift out
// of sync with it again the way a hardcoded constant once did.
const SHADOW_EXTENT_MARGIN = 4; // clearance past the outermost wall face, beyond its own thickness
const SHADOW_EXTENT = FLOOR_HALF_SIZE + SHADOW_EXTENT_MARGIN;
const SHADOW_CAMERA_NEAR = 1;

// The shadow camera sits AT the light and looks down SUN_DIRECTION, so how
// far out the light stands is not cosmetic: anything behind that camera's
// near plane is clipped and casts nothing, exactly as silently as something
// outside the box above. A directional light's shading depends only on its
// direction, never its distance, so the distance is free to set from
// geometry -- and one floor half-diagonal guarantees every point on the
// floor projects in front of the camera whichever way the light looks.
// The retired fixed position stood only ~34 units out, which was past the
// old 34-unit floor but well inside this one: the whole Bazaar district,
// both cross-cut corridors and part of the Maze fell behind the near plane
// and stopped casting. test/render/shadowCoverage.test.js now projects
// every wall and pillar corner into light space to keep all four limits
// honest, not just the two this file re-derived.
const SUN_DIRECTION_LENGTH = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z);
const SUN_DISTANCE = FLOOR_HALF_SIZE * Math.SQRT2 + SHADOW_EXTENT_MARGIN;
const SUN_POSITION = {
  x: (SUN_DIRECTION.x / SUN_DIRECTION_LENGTH) * SUN_DISTANCE,
  y: (SUN_DIRECTION.y / SUN_DIRECTION_LENGTH) * SUN_DISTANCE,
  z: (SUN_DIRECTION.z / SUN_DIRECTION_LENGTH) * SUN_DISTANCE,
};
// Far plane budget: the sun's own distance from the target plus the floor's
// half-diagonal (worst-case corner distance from the target), with headroom
// -- covers every wall regardless of which direction the light looks across
// the floor.
const SHADOW_CAMERA_FAR = SUN_DISTANCE + FLOOR_HALF_SIZE * Math.SQRT2 + 20;
// Depth-comparison offsets that keep a surface from shadowing itself. Without
// them a lit floor is covered in acne; too much and shadows detach from the
// object casting them (peter-panning) -- which reads as a lit strip along the
// foot of every wall, the wall apparently hovering over its own shadow.
//
// `bias` is the trap: three.js scales it by the shadow camera's near/far
// span, so the same literal buys a different distance in world units every
// time that span moves. -0.0006 was tuned against an 89-unit span, which
// made it 0.053 world units. The districts arena took the span to 133, and
// standing the sun off far enough to clear its own near plane took it to
// 183 -- the same literal now meaning 0.11 units, enough to lift every
// wall's shadow visibly clear of its base throughout the arena. Rescaling
// it back only halves the strip; it was faintly there at 0.053 too.
//
// `normalBias` causes the same defect by a different route: it offsets the
// lookup along the receiving surface's normal, so on a floor it lifts the
// sample straight up and the wall's shadow starts fractionally out from the
// wall. Sampling the live framebuffer across the junction, 0.03 put a
// one-pixel spike of 76 luminance between a 42 wall and a 47 floor -- the
// bright seam. Zero reads 49, level with the floor either side of it.
//
// Both are zero because neither is buying anything here. three.js renders
// BACK faces into the shadow map for a FrontSide material, so a caster's own
// lit faces are never in the depth map and cannot self-shadow; the floor is
// receive-only (arenaMesh.js sets no castShadow on it) so it is not in there
// at all. That leaves nothing for these offsets to protect against, which is
// why zeroing both shows no acne on walls, pillars, cover blocks, bots or a
// sunlit floor at 2048, where a bigger texel would surface it first.
//
// The premise, not the numbers, is what to re-check if this ever needs
// revisiting: give the ground `castShadow`, or override `shadowSide`, and
// self-shadowing becomes reachable again and these offsets start earning
// their keep. shadowCoverage.test.js bounds their combined world-space size
// so neither can quietly grow back in the meantime.
const SHADOW_BIAS = 0;
const SHADOW_NORMAL_BIAS = 0;

// Changes the sun's shadow-map resolution on a live scene. three.js
// allocates the depth target once and then reuses it, so a new mapSize is
// ignored until the old target is released -- which is the whole reason this
// is a function here rather than a field the caller can set.
export function applyShadowQuality(sun, quality) {
  const size = shadowMapSize(quality);
  if (sun.shadow.mapSize.width === size) return;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
}

export function createScene({ aspect = 16 / 9, shadowQuality = DEFAULT_SHADOW_QUALITY } = {}) {
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
  sun.shadow.mapSize.set(shadowMapSize(shadowQuality), shadowMapSize(shadowQuality));
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
// other loaded asset (BOT_MODEL, MACHINEGUN_MODEL, MACHINEGUN_GUNSHOT_PATHS)
// already lives in main.js's own `assetUrl` helper, and createScene has no
// renderer/DOM dependency today -- adding one here would duplicate that
// helper instead of reusing it. main.js calls this once scene/camera exist,
// the same shape as the machine gun model's own load-and-wire call.
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
