// Post-processing chain: turns the single renderer.render() call into a
// multi-pass composer (ambient occlusion, bloom, anti-alias, tone map)
// without touching the lighting rig or scene content it renders -- KTD1,
// R8, R9.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// SSAOPass's own render target is decoupled from the composer's main
// resolution -- composer.setSize hands every pass the full frame size on
// resize, SSAOPass included, so this scale has to be reapplied after every
// resize (see setSize below) or AO silently snaps back to full-res on the
// first window resize. Half-res is the spike's starting point per KTD1;
// moving it is an owner fps-measurement call this unit doesn't make (see
// U1's report -- not measured in this sandbox).
const AO_RESOLUTION_SCALE = 0.5;

// High threshold / low strength so only genuinely bright sources (muzzle
// flash, accent trim) catch bloom -- R8 requires this read as polish, never
// as a filter. Starting point for the owner's retune spike under R10's
// license; not validated against a running frame in this sandbox.
const BLOOM_STRENGTH = 0.35;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.9;

// Assembles the composer in KTD1's exact order: world render -> SSAO
// (reduced-res target) -> [U2's viewmodel depth-clear pass] -> bloom -> AA
// -> OutputPass last. `width`/`height` are the renderer's current
// drawing-buffer size in CSS pixels (the same units `renderer.setSize`
// takes) -- SSAOPass and UnrealBloomPass both need an explicit resolution
// at construction, unlike RenderPass/SMAAPass/OutputPass, which read only
// the scene/camera or nothing at all.
export function createPostFX({ renderer, scene, camera, width, height }) {
  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const ssaoPass = new SSAOPass(scene, camera, width * AO_RESOLUTION_SCALE, height * AO_RESOLUTION_SCALE);
  composer.addPass(ssaoPass);

  // --- U2 insertion point -------------------------------------------
  // KTD4's viewmodel depth-clear pass (the held weapon rendered through its
  // own tight-frustum camera, depth buffer cleared first, so it can never
  // clip into world geometry) belongs here -- after AO, before bloom, so
  // its muzzle flash still blooms and it picks up no AO boundary artifacts
  // from the world geometry behind it. This unit only reserves the
  // position; U2 owns building and inserting that pass.
  // --------------------------------------------------------------------

  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(width, height), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
  );

  // SMAA, not FXAA: FXAAPass's own doc comment requires sRGB input, meaning
  // it would have to run *after* OutputPass -- incompatible with KTD1's
  // OutputPass-last order. SMAAPass documents itself as operating in
  // linear-srgb, so it belongs before OutputPass instead, and is what
  // "replaces the MSAA lost off-screen" without breaking the tone-map/sRGB
  // finisher.
  composer.addPass(new SMAAPass());

  // Must terminate the chain: this is what applies the renderer's own ACES
  // tone mapping and sRGB output encoding to the composited result -- with
  // anything after it (or without it at all) the ACES look washes out
  // (KTD1). It reads tone mapping/exposure from `renderer` itself, so main.js
  // sets those on the renderer exactly as it does today; no separate wiring
  // is needed here.
  composer.addPass(new OutputPass());

  // Mirrors EffectComposer.setSize's own per-pass loop, plus SSAOPass's
  // reduced-resolution override described above.
  function setSize(newWidth, newHeight) {
    composer.setSize(newWidth, newHeight);
    ssaoPass.setSize(newWidth * AO_RESOLUTION_SCALE, newHeight * AO_RESOLUTION_SCALE);
  }

  return { composer, setSize };
}
