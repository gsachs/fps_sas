import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { createRenderLoop } from './render/loop.js';

const app = document.getElementById('app');

// preserveDrawingBuffer defaults off (perf cost); enabled only via ?debug for
// automated visual verification, where readPixels must see the post-render buffer.
const debugMode = new URLSearchParams(window.location.search).has('debug');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: debugMode });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const { scene, camera } = createScene({ aspect: window.innerWidth / window.innerHeight });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Click-to-play overlay. Full pointer-lock lifecycle (resume overlay,
// re-lock-after-cooldown handling, unadjustedMovement fallback) lands in
// U8's src/shell/pointerLock.js; this is the minimal engage/exit smoke path.
const overlay = document.createElement('div');
overlay.textContent = 'Click to Play';
overlay.style.cssText =
  'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
  'color:#fff;font-size:2rem;cursor:pointer;background:rgba(0,0,0,0.5);';
app.appendChild(overlay);

overlay.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  overlay.style.display = document.pointerLockElement === renderer.domElement ? 'none' : 'flex';
});

document.addEventListener('pointerlockerror', () => {
  console.warn('Pointer lock request failed or was rejected.');
});

const statsEl = document.createElement('div');
statsEl.style.cssText = 'position:absolute;top:8px;left:8px;color:#0f0;font:12px monospace;';
app.appendChild(statsEl);
let frames = 0;
let fpsAccum = 0;

const loop = createRenderLoop({
  renderer,
  scene,
  camera,
  onFrame(delta) {
    frames += 1;
    fpsAccum += delta;
    if (fpsAccum >= 1) {
      statsEl.textContent = `${Math.round(frames / fpsAccum)} fps`;
      frames = 0;
      fpsAccum = 0;
    }
  },
});
loop.start();
