import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './render/scene.js';
import { createRenderLoop } from './render/loop.js';
import { buildArenaMeshes } from './render/arenaMesh.js';
import { createArena } from './arena/arena.js';
import { pickSpawnPoint } from './arena/spawns.js';
import { createSimulation } from './sim/index.js';
import { createMovementSystem, EYE_HEIGHT, CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from './sim/movement.js';
import { createWeaponSystem } from './sim/weapon.js';
import { createHealthSystem } from './sim/health.js';
import { createBotAI } from './sim/bot/fsm.js';
import { getActiveBotCount } from './shell/botRamp.js';
import { createInputSampler } from './input/sampler.js';
import { createCharacterMesh, computeBotMeshYaw, computeBotMeshY, computeCameraYaw } from './render/entityMesh.js';
import { loadCharacterModel, disposeObject3D } from './render/models.js';
import { createAnimatedCharacter } from './render/mixer.js';
import { createHud } from './ui/hud.js';
import { createDamageIndicator, computeAngleFromPlayer } from './render/feedback.js';
import { createWeaponView } from './render/weaponView.js';
import { createTracerSystem } from './render/tracer.js';
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

// BASE_URL-relative, not a hard-coded leading slash: this must resolve
// correctly when deployed under a subpath (e.g. a GitHub Pages project
// page), not just when served from a host's root.
const CHARACTER_MODEL_URL = `${import.meta.env.BASE_URL}assets/characters/quaternius-base-character.glb`;
// The downloaded pistol model (public/assets/weapons/quaternius-pistol.glb)
// is a *skinned* mesh (rigged to its own reload/fire animation, with a
// baked 100x scale split across its armature and mesh nodes) rather than a
// static prop. loadPropModel's plain .clone() doesn't preserve skin
// bindings the way loadCharacterModel's SkeletonUtils.clone() does, and
// three independent scale attempts (0.12, 0.003, 0.00001) all rendered
// identically -- confirmed via the raw GLTF node hierarchy (Muzzle/mesh
// node scale ~100, sibling to the armature, not nested under it). Left
// unwired for now: the placeholder weapon box is clean and correct: a
// static (non-skinned) pistol model swapped in via loadPropModel would
// need re-sourcing, not more scale tuning.

const hud = createHud(app);
const damageIndicator = createDamageIndicator(app);
const weaponView = createWeaponView(camera);
const tracers = createTracerSystem(scene);

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
// Reinforcements not yet unlocked by the ramp (shell/botRamp.js) sit parked
// here -- far enough below the arena that no hitscan ray reaches them
// (HITSCAN_MAX_DISTANCE is 100; the ground collider blocks a downward ray
// long before then anyway) -- rather than being removed from the sim, which
// has no entity-removal path (KTD2's entity store is add-only).
const PARK_POSITION = { x: 0, y: -100, z: 0 };
let matchElapsedSeconds = 0;
let lastRenderState = [];

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
    for (const { id, bot, active } of bots) {
      if (!active) continue; // not yet unlocked by the ramp -- frozen in place, no command at all
      const botEntity = sim.world.getEntity(id);
      if (botEntity && !botEntity.dead) {
        commands.set(id, bot.sample(botEntity.position, playerPosition, botEntity.health));
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
  const botEntry = {
    id: botId,
    bot: createBotAI({ rapierWorld: arena.rapierWorld, movementSystem, botId }),
    mesh,
    animatedCharacter: null,
    yawOffset: 0,
    modelYOffset: 0,
    active: true,
  };
  bots.push(botEntry);

  // Placeholder capsule renders immediately; the real model swaps in once
  // loaded (or never, on failure -- R9's error path), so startup is never
  // blocked on the asset load.
  loadCharacterModel(CHARACTER_MODEL_URL, {
    onError: (error) => console.warn(`Failed to load character model for ${botId}:`, error),
  }).then((result) => {
    if (!result) return;
    const { scene: modelScene, animations } = result;
    modelScene.scale.setScalar(0.9);
    botEntry.yawOffset = Math.PI; // this rig's forward faces -Z; entity yaw=0 faces +Z
    // This rig has a feet-based origin, not the center-based origin the
    // placeholder capsule (and the physics capsule) use -- without this, the
    // visible character floats ~0.8 units above its actual hitbox, so a shot
    // aimed at the character can sail clean over the real collider.
    botEntry.modelYOffset = -(CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);
    modelScene.visible = botEntry.mesh.visible;
    scene.remove(botEntry.mesh);
    disposeObject3D(botEntry.mesh);
    botEntry.mesh = modelScene;
    scene.add(modelScene);
    botEntry.animatedCharacter = createAnimatedCharacter(modelScene, animations);
  });
}

// Ramp reinforcements in (shell/botRamp.js): later-indexed bots start
// parked and inactive, then get moved to a real spawn and unlocked as the
// match clock advances (see onFrame). Bots within the initial unlocked
// count just play normally from their already-assigned spawn.
parkBotsBeyondRampCount();

// Shared by initial setup and onRestart, so the parking rule can't drift
// between the two call sites the way a duplicated loop could.
function parkBotsBeyondRampCount() {
  for (let i = getActiveBotCount(0, BOT_COUNT); i < bots.length; i++) {
    deactivateBot(bots[i]);
  }
}

function activateBot(botEntry) {
  // Every live entity except this bot itself, matching the convention
  // world.js's tickRespawns and matchEnd.js's resetMatch already use --
  // built from active bots only (as this did before), the player was
  // invisible to spawn selection, so a reinforcement could land exactly on
  // the player's position (spawnPoints[0], where the player starts).
  const occupied = sim.world
    .allEntities()
    .filter((entity) => !entity.dead && entity.id !== botEntry.id)
    .map((entity) => entity.position);
  const spawn = pickSpawnPoint(arena.spawnPoints, occupied);
  sim.world.getEntity(botEntry.id).position = { ...spawn };
  movementSystem.teleport(botEntry.id, spawn);
  botEntry.mesh.visible = true;
  botEntry.active = true;
}

function deactivateBot(botEntry) {
  sim.world.getEntity(botEntry.id).position = { ...PARK_POSITION };
  movementSystem.teleport(botEntry.id, PARK_POSITION);
  botEntry.mesh.visible = false;
  botEntry.active = false;
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
  onRestart: () => {
    resetMatch(sim.world, { spawnPoints: arena.spawnPoints, pickSpawnPoint, movementSystem, healthSystem });
    // resetMatch repositions every entity in the world, including bots the
    // ramp hadn't unlocked yet -- re-park those so the new match starts the
    // ramp over instead of carrying over the previous match's bot count.
    matchElapsedSeconds = 0;
    parkBotsBeyondRampCount();
  },
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
  // Asks THREE.js directly what direction the camera actually faces, so it
  // can be compared against the sim's own movement-forward convention
  // (sin(yaw), cos(yaw)) for the same yaw -- settles whether what the
  // player visually aims at matches what the weapon ray actually targets,
  // without re-deriving rotation matrices by hand.
  window.__debugCameraForward = () => {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    return { x: dir.x, y: dir.y, z: dir.z };
  };
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
  // Reports the current bot0 mesh's world-space bounding-box size -- for
  // tuning loaded-model scale, not gameplay-relevant.
  window.__debugModelSizes = () => ({
    bot0: bots[0] ? new THREE.Box3().setFromObject(bots[0].mesh).getSize(new THREE.Vector3()) : null,
  });
  // Reports bot0's visual mesh bounds (world Y) alongside its entity
  // position, so automated verification can confirm the model is anchored
  // to line up with the actual (invisible) capsule collider -- a mismatch
  // there would let a shot that visually looks like a hit still miss the
  // real hitbox.
  window.__debugBotMeshBounds = () => {
    if (!bots[0]) return null;
    const box = new THREE.Box3().setFromObject(bots[0].mesh);
    return {
      entityPositionY: sim.world.getEntity(bots[0].id)?.position.y,
      meshMinY: box.min.y,
      meshMaxY: box.max.y,
    };
  };
  // Reports each bot's sim yaw alongside its rendered mesh yaw, so
  // automated verification can confirm the model's rest-facing offset is
  // actually being composed into the per-frame rotation, not silently
  // dropped -- the exact failure mode this guards against.
  window.__debugBotYaws = () =>
    bots.map((b) => ({ id: b.id, entityYaw: sim.world.getEntity(b.id)?.yaw, meshYaw: b.mesh.rotation.y }));
  // Counts live tracer lines in the scene graph, for verifying the tracer
  // effect actually spawns (and expires) without a human watching the screen.
  window.__debugTracerCount = () => scene.children.filter((child) => child.type === 'Line').length;
  // Reports the bot ramp's live state, for verifying reinforcements unlock
  // over a match without waiting out the real ramp interval by hand.
  window.__debugBotRamp = () => ({
    matchElapsedSeconds,
    activeCount: bots.filter((b) => b.active).length,
    targetCount: getActiveBotCount(matchElapsedSeconds, BOT_COUNT),
  });
  // Reports each bot's FSM phase and position, for diagnosing AI behavior
  // (stuck idle vs. chasing vs. attacking) without a human watching the screen.
  window.__debugBotPhases = () =>
    bots.map((b) => ({
      id: b.id,
      active: b.active,
      phase: b.bot.getPhase(),
      position: sim.world.getEntity(b.id)?.position,
      meshVisible: b.mesh.visible,
      dead: sim.world.getEntity(b.id)?.dead,
      health: sim.world.getEntity(b.id)?.health,
    }));
  // Reports each bot's last *rendered* (interpolated) position alongside its
  // raw/authoritative sim position, so automated verification can check
  // whether a shot aimed at what's actually drawn on screen (interpolated)
  // still lands, versus one aimed at the raw sim position (as prior
  // verification in this session always did).
  window.__debugBotRenderVsSimPosition = () =>
    bots.map((b) => ({
      id: b.id,
      rendered: lastRenderState.find((e) => e.id === b.id)?.position,
      raw: sim.world.getEntity(b.id)?.position,
    }));
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

    // Ramp reinforcements in over the match (shell/botRamp.js) -- the clock
    // only advances while actually playing, so pausing doesn't burn ramp time.
    matchElapsedSeconds += delta;
    const targetActiveBots = getActiveBotCount(matchElapsedSeconds, BOT_COUNT);
    for (const botEntry of bots) {
      if (botEntry.active) continue;
      if (bots.filter((b) => b.active).length >= targetActiveBots) break;
      activateBot(botEntry);
    }

    const { alpha, events } = sim.tick(delta);
    const renderState = sim.getRenderState(alpha);
    if (debugMode) lastRenderState = renderState;
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
        // Local-player camera only -- bot meshes already use the generic
        // +Z-front convention and don't need this correction (see
        // computeCameraYaw's doc comment in entityMesh.js for why the
        // camera does).
        camera.rotation.set(entity.latest.pitch, computeCameraYaw(entity.latest.yaw), 0, 'YXZ');
        continue;
      }

      const botEntry = bots.find((b) => b.id === entity.id);
      if (botEntry) {
        // Not yet unlocked by the ramp overrides the death-hides-mesh rule
        // below -- a parked bot is never "dead", so !entity.dead alone would
        // make it visible again the instant this runs.
        if (!botEntry.active) continue;
        botEntry.mesh.visible = !entity.dead;
        botEntry.mesh.position.set(
          entity.position.x,
          computeBotMeshY(entity.position.y, botEntry.modelYOffset),
          entity.position.z
        );
        botEntry.mesh.rotation.y = computeBotMeshYaw(entity.yaw, botEntry.yawOffset);
        botEntry.animatedCharacter?.setBaseHint(entity.animHint);
        botEntry.animatedCharacter?.update(delta);
      }
    }

    for (const event of events) {
      if (event.type === 'fire' && event.shooterId === LOCAL_PLAYER_ID) {
        weaponView.fire();
        if (debugMode) debugCounters.fires += 1;
      }
      if (event.type === 'fire') {
        bots.find((b) => b.id === event.shooterId)?.animatedCharacter?.playFireReaction();
        tracers.spawn(event.origin, event.endPoint);
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
    tracers.update(delta);
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
