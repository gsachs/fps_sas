import * as THREE from 'three';

// Frame time is clamped so a tab-refocus stall doesn't produce a runaway
// delta (spiral of death) once U3's fixed-step accumulator consumes it.
const MAX_FRAME_SECONDS = 0.25;

// `render` draws the frame -- a plain `renderer.render(scene, camera)`
// wrapper or (since U1) `composer.render(delta)` -- so this module's only
// job stays driving frames, not owning what rendering a frame means.
export function createRenderLoop({ render, onFrame }) {
  const timer = new THREE.Timer();
  timer.connect(document);
  let rafId = null;

  function tick() {
    timer.update();
    const delta = Math.min(timer.getDelta(), MAX_FRAME_SECONDS);
    if (onFrame) onFrame(delta);
    render(delta);
    rafId = requestAnimationFrame(tick);
  }

  return {
    start() {
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
}
