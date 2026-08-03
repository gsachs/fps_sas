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
import { createHud } from './ui/hud.js';
import { createDamageIndicator, computeAngleFromPlayer } from './render/feedback.js';
import { createWeaponView } from './render/weaponView.js';
import { createGameShell } from './shell/states.js';
import { checkMatchEnd, resetMatch } from './shell/matchEnd.js';

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

const hud = createHud(app);
const damageIndicator = createDamageIndicator(app);
const weaponView = createWeaponView(camera);

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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const gameShell = createGameShell({
  container: app,
  lockElement: renderer.domElement,
  localPlayerId: LOCAL_PLAYER_ID,
  onRestart: () =>
    resetMatch(sim.world, { spawnPoints: arena.spawnPoints, pickSpawnPoint, movementSystem, healthSystem }),
});

// Read-only/test-only hooks for automated verification; never wired to any
// gameplay input path, so they carry no effect unless explicitly called.
const debugCounters = { fires: 0, crosshairFlashes: 0, damageIndicatorShows: 0 };
if (debugMode) {
  window.__debugState = () => ({
    player: sim.world.getEntity(LOCAL_PLAYER_ID),
    bots: bots.map(({ id }) => sim.world.getEntity(id)),
    counters: { ...debugCounters },
  });
  // Triggers the same fire-latch path a real mousedown does, for automated
  // verification in a harness where pointer lock cannot engage.
  window.__debugFire = () => inputSampler.onFirePressed();
  // Sets the player's yaw directly (bypassing the pointer-lock-gated
  // mousemove listener) so automated verification can aim at a known
  // target instead of firing in whatever direction yaw defaulted to.
  window.__debugSetYaw = (targetYaw) => inputSampler.setYaw(targetYaw);
  // Directly sets an entity's score, so automated verification can reach
  // match-end without playing out KILLS_TO_WIN real kills.
  window.__debugSetScore = (entityId, score) => {
    sim.world.getEntity(entityId).score = score;
  };
  window.__debugShellState = () => gameShell.getState();
  // See states.js's debugForceLockAcquired doc comment: real Pointer Lock
  // cannot be acquired under headless automation at all.
  window.__debugForcePlaying = () => gameShell.debugForceLockAcquired();
  window.__debugForcePaused = () => gameShell.debugForceLockLost();
}

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
    // The scene still renders every frame regardless (render/loop.js calls
    // renderer.render after this returns), so start/pause/results screens
    // show over a frozen last-playing frame rather than a blank canvas.
    if (!gameShell.isSimRunning()) return;

    const { alpha, events } = sim.tick(delta);
    const renderState = sim.getRenderState(alpha);
    let playerEntity = null;

    for (const entity of renderState) {
      if (entity.id === LOCAL_PLAYER_ID) {
        playerEntity = entity;
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

    for (const event of events) {
      if (event.type === 'fire' && event.shooterId === LOCAL_PLAYER_ID) {
        weaponView.fire();
        if (debugMode) debugCounters.fires += 1;
      }
      if (event.type === 'hit' && event.shooterId === LOCAL_PLAYER_ID) {
        hud.flashCrosshair(event.killed ? 'kill' : 'hit');
        if (debugMode) debugCounters.crosshairFlashes += 1;
      }
      if (event.type === 'hit' && event.targetId === LOCAL_PLAYER_ID && event.shooterPosition) {
        const angle = computeAngleFromPlayer(
          playerEntity.latest.position,
          playerEntity.latest.yaw,
          event.shooterPosition
        );
        damageIndicator.show(angle);
        if (debugMode) debugCounters.damageIndicatorShows += 1;
      }
    }

    weaponView.update(delta);
    hud.update({
      health: playerEntity.health,
      score: playerEntity.score,
      dead: playerEntity.dead,
      respawnSecondsRemaining: healthSystem.getRespawnTicksRemaining(LOCAL_PLAYER_ID) * sim.dt,
    });

    const matchResult = checkMatchEnd(sim.world);
    if (matchResult.ended) {
      gameShell.showResults(matchResult.leaderboard);
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
