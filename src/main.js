import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './render/scene.js';
import { createRenderLoop } from './render/loop.js';
import { buildArenaMeshes } from './render/arenaMesh.js';
import { createArena } from './arena/arena.js';
import { pickSpawnPoint } from './arena/spawns.js';
import { createSimulation } from './sim/index.js';
import { createMovementSystem, EYE_HEIGHT } from './sim/movement.js';
import { createWeaponSystem } from './sim/weapon.js';
import { createHealthSystem } from './sim/health.js';
import { createBasicBot } from './sim/bot/basic.js';
import { createInputSampler } from './input/sampler.js';
import { createCharacterMesh } from './render/entityMesh.js';

await RAPIER.init();

const app = document.getElementById('app');

// preserveDrawingBuffer defaults off (perf cost); enabled only via ?debug for
// automated visual verification, where readPixels must see the post-render buffer.
const debugMode = new URLSearchParams(window.location.search).has('debug');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: debugMode });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const { scene, camera } = createScene({ aspect: window.innerWidth / window.innerHeight });

const arena = createArena();
scene.add(buildArenaMeshes(arena));

const inputSampler = createInputSampler();
const movementSystem = createMovementSystem(arena.rapierWorld);
const weaponSystem = createWeaponSystem({ rapierWorld: arena.rapierWorld, movementSystem });
const healthSystem = createHealthSystem({
  pickSpawnPoint,
  spawnPoints: arena.spawnPoints,
  movementSystem,
});
const combat = {
  resolveFire: weaponSystem.resolveFire,
  applyHit: healthSystem.applyHit,
  tickRespawns: healthSystem.tickRespawns,
};

const LOCAL_PLAYER_ID = 'player';
const BOT_COUNT = 4; // v1 target bot count (Success Criteria); tune here during playtest

// gatherCommands closes over `sim` and `bots` before either is assigned --
// safe because it only runs later, from sim.tick() in the render loop, by
// which point both exist (bots need sim.world to add entities to, so they
// can't be built first).
const sim = createSimulation({
  physics: movementSystem,
  combat,
  gatherCommands: () => {
    const commands = new Map([[LOCAL_PLAYER_ID, inputSampler.sample()]]);
    const playerPosition = sim.world.getEntity(LOCAL_PLAYER_ID).position;
    for (const { id, bot } of bots) {
      const botEntity = sim.world.getEntity(id);
      if (botEntity && !botEntity.dead) {
        commands.set(id, bot.sample(botEntity.position, playerPosition));
      }
    }
    return commands;
  },
});

const occupiedSpawns = [];
const spawn = pickSpawnPoint(arena.spawnPoints, occupiedSpawns);
occupiedSpawns.push(spawn);
sim.world.addEntity(LOCAL_PLAYER_ID, { position: { ...spawn } });
movementSystem.addCharacter(LOCAL_PLAYER_ID, spawn);

const bots = [];
for (let i = 0; i < BOT_COUNT; i++) {
  const botId = `bot${i}`;
  const botSpawn = pickSpawnPoint(arena.spawnPoints, occupiedSpawns);
  occupiedSpawns.push(botSpawn);
  sim.world.addEntity(botId, { position: { ...botSpawn } });
  movementSystem.addCharacter(botId, botSpawn);
  const mesh = createCharacterMesh({ color: 0x7a3b3b });
  scene.add(mesh);
  bots.push({ id: botId, bot: createBasicBot(), mesh });
}

// Rapier's broad-phase only indexes newly-created colliders on the next
// world.step(); priming once here (safe -- every body is still kinematic
// with no translation queued yet) ensures the very first real tick's
// hitscan and movement queries see a fully up-to-date broad-phase.
movementSystem.commit();

// Read-only state hook for automated verification; never wired to any
// input or mutation path, so it carries no gameplay effect.
if (debugMode) {
  window.__debugState = () => ({
    player: sim.world.getEntity(LOCAL_PLAYER_ID),
    bots: bots.map(({ id }) => sim.world.getEntity(id)),
  });
  // Triggers the same fire-latch path a real mousedown does, for automated
  // verification in a harness where pointer lock cannot engage.
  window.__debugFire = () => inputSampler.onFirePressed();
}

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

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === renderer.domElement) {
    inputSampler.onMouseMove(event);
  }
});
document.addEventListener('mousedown', (event) => {
  if (document.pointerLockElement === renderer.domElement && event.button === 0) {
    inputSampler.onFirePressed();
  }
});
document.addEventListener('keydown', (event) => inputSampler.onKeyDown(event));
document.addEventListener('keyup', (event) => inputSampler.onKeyUp(event));

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
    const alpha = sim.tick(delta);
    const renderState = sim.getRenderState(alpha);

    for (const entity of renderState) {
      if (entity.id === LOCAL_PLAYER_ID) {
        // The local player's camera renders from the latest sim state (not
        // interpolated) so aiming stays responsive -- KTD2's carve-out,
        // validated by the U2 latency spike. Other entities interpolate
        // via entity.position/entity.yaw instead.
        camera.position.set(
          entity.latest.position.x,
          entity.latest.position.y + EYE_HEIGHT,
          entity.latest.position.z
        );
        camera.rotation.set(entity.latest.pitch, entity.latest.yaw, 0, 'YXZ');
        continue;
      }

      const botEntry = bots.find((b) => b.id === entity.id);
      if (botEntry) {
        botEntry.mesh.visible = !entity.dead;
        botEntry.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        botEntry.mesh.rotation.y = entity.yaw;
      }
    }

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
