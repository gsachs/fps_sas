import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './render/scene.js';
import { createRenderLoop } from './render/loop.js';
import { buildArenaMeshes } from './render/arenaMesh.js';
import { createArena } from './arena/arena.js';
import { selectSpawnPoint } from './arena/spawnPlacement.js';
import { createSimulation } from './sim/index.js';
import { createMovementSystem, EYE_HEIGHT, CAPSULE_GROUND_OFFSET } from './sim/movement.js';
import { createWeaponSystem } from './sim/weapon.js';
import { createHealthSystem } from './sim/health.js';
import { createPickupSystem } from './sim/pickups.js';
import { createGrenadeSystem } from './sim/grenades.js';
import { createBotAI } from './sim/bot/fsm.js';
import { getActiveBotCount, buildOccupiedPositions } from './shell/botRamp.js';
import { createInputSampler } from './input/sampler.js';
import { createCharacterMesh, computeBotMeshYaw, computeBotMeshY, computeCameraYaw } from './render/entityMesh.js';
import { loadCharacterModel, loadPropModel, disposeObject3D } from './render/models.js';
import { BOT_MODEL, WEAPON_MODEL, GUNSHOT_PATHS } from './render/modelAssets.js';
import { createAnimatedCharacter } from './render/mixer.js';
import { createHud } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { createKillfeed } from './ui/killfeed.js';
import { LOCAL_PLAYER_ID } from './ui/names.js';
import { createDamageIndicator, computeAngleFromPlayer } from './render/feedback.js';
import { createWeaponView } from './render/weaponView.js';
import { createTracerSystem } from './render/tracer.js';
import { createImpactSystem, shooterIdsThatHit } from './render/impacts.js';
import { createPickupMeshes } from './render/pickupMeshes.js';
import { createGrenadeFX } from './render/grenadeFX.js';
import { createGunshotAudio } from './audio/gunshots.js';
import { createGameShell } from './shell/states.js';
import { checkMatchEnd, resetMatch } from './shell/matchEnd.js';
import { renderStartupError } from './shell/startupError.js';

try {
  await RAPIER.init();
} catch (error) {
  console.error('RAPIER.init failed:', error);
  renderStartupError(document.getElementById('app'), 'Physics engine failed to load. Reload to try again.');
  throw error;
}

const app = document.getElementById('app');

// preserveDrawingBuffer defaults off (perf cost); enabled only via ?debug for
// automated visual verification, where readPixels must see the post-render buffer.
const debugMode = new URLSearchParams(window.location.search).has('debug');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: debugMode });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
// Shadows are what ground an object to the surface it stands on; without
// them a correctly-placed character still reads as floating (R12).
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Tone mapping so bright things -- muzzle flash, tracer, impact spark -- roll
// off into white instead of clipping flat at it, which is what made them read
// as coloured shapes rather than as light (R13).
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const { scene, camera } = createScene({ aspect: window.innerWidth / window.innerHeight });

const arena = createArena();
scene.add(buildArenaMeshes(arena));

// BASE_URL-relative, not a hard-coded leading slash: this must resolve
// correctly when deployed under a subpath (e.g. a GitHub Pages project
// page), not just when served from a host's root.
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;

const hud = createHud(app);
// R8: joins the app container ahead of the shell screens created below (see
// createGameShell) so it paints underneath them and inherits their overlay
// coverage for free, the same way the rest of the HUD does.
const killfeed = createKillfeed(app);
const minimap = createMinimap(app, arena);
const damageIndicator = createDamageIndicator(app);
const weaponView = createWeaponView(camera);
const tracers = createTracerSystem(scene);
const impacts = createImpactSystem(scene);
const pickupMeshes = createPickupMeshes(scene, arena.pickups);
const grenadeFX = createGrenadeFX(scene);
const gunshots = createGunshotAudio({
  camera,
  scene,
  urls: GUNSHOT_PATHS.map(assetUrl),
  onError: (error) => console.warn('Failed to load gunshot audio:', error),
});
// Any click reaches this before the pointer-lock request it belongs to, so
// the existing click-to-play gesture doubles as the audio unlock the browser
// requires -- no separate "click to enable sound" step.
app.addEventListener('pointerdown', () => gunshots.unlock());

const inputSampler = createInputSampler();
const movementSystem = createMovementSystem(arena.rapierWorld);
const weaponSystem = createWeaponSystem({ rapierWorld: arena.rapierWorld, movementSystem });
const healthSystem = createHealthSystem({
  rapierWorld: arena.rapierWorld,
  spawnPoints: arena.spawnPoints,
  movementSystem,
});
const combat = {
  resolveFire: weaponSystem.resolveFire,
  applyHit: healthSystem.applyHit,
  tickRespawns: healthSystem.tickRespawns,
};

// R7: grenade pickups are player-only -- pickups.js has no concept of a
// local-player id of its own, so this predicate is the seam that decides
// eligibility without leaking a render/DOM concern into the sim layer.
const pickupSystem = createPickupSystem({
  pickups: arena.pickups,
  isLocalPlayer: (entity) => entity.id === LOCAL_PLAYER_ID,
});
const grenadeSystem = createGrenadeSystem({ rapierWorld: arena.rapierWorld, healthSystem, movementSystem });
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
  pickups: pickupSystem,
  grenades: grenadeSystem,
  gatherCommands: () => {
    const commands = new Map([[LOCAL_PLAYER_ID, inputSampler.sample()]]);
    const playerEntity = sim.world.getEntity(LOCAL_PLAYER_ID);
    for (const { id, bot, active } of bots) {
      if (!active) continue; // not yet unlocked by the ramp -- frozen in place, no command at all
      const botEntity = sim.world.getEntity(id);
      if (botEntity && !botEntity.dead) {
        // !playerEntity.dead: a corpse is never a live target (U4) -- the
        // sim's own liveness gate, threaded in rather than the FSM guessing
        // it from position alone (Core Invariant: never pass null).
        commands.set(
          id,
          bot.sample(botEntity.position, playerEntity.position, botEntity.health, botEntity.heldWeapon, !playerEntity.dead)
        );
      }
    }
    return commands;
  },
});

// R11: match start additionally places no two entities in mutual view --
// placing each in turn out of every already-placed entity's sight gives
// the whole set that for free (line of sight is symmetric).
const occupiedSpawns = [];
const spawn = selectSpawnPoint(arena.rapierWorld, arena.spawnPoints, {
  enemyPositions: occupiedSpawns,
  occupiedPositions: occupiedSpawns,
});
occupiedSpawns.push(spawn);
sim.world.addEntity(LOCAL_PLAYER_ID, { position: { ...spawn } });
movementSystem.addCharacter(LOCAL_PLAYER_ID, spawn);

const bots = [];
for (let i = 0; i < BOT_COUNT; i++) {
  const botId = `bot${i}`;
  const botSpawn = selectSpawnPoint(arena.rapierWorld, arena.spawnPoints, {
    enemyPositions: occupiedSpawns,
    occupiedPositions: occupiedSpawns,
  });
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
  loadCharacterModel(assetUrl(BOT_MODEL.path), {
    onError: (error) => console.warn(`Failed to load character model for ${botId}:`, error),
  }).then((result) => {
    if (!result) return;
    const { scene: modelScene, animations } = result;
    modelScene.scale.setScalar(BOT_MODEL.scale);
    botEntry.yawOffset = BOT_MODEL.yawOffset;
    // This rig has a feet-based origin, not the center-based origin the
    // placeholder capsule (and the physics capsule) use -- without this, the
    // visible character floats ~0.8 units above its actual hitbox, so a shot
    // aimed at the character can sail clean over the real collider.
    botEntry.modelYOffset = -CAPSULE_GROUND_OFFSET;
    // Every mesh in a loaded rig opts into shadows individually -- setting
    // the flag on the root does nothing, since the renderer reads it per
    // mesh. A bot that casts no shadow is the floating-sticker look that
    // shadows were turned on to fix.
    modelScene.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    modelScene.visible = botEntry.mesh.visible;
    scene.remove(botEntry.mesh);
    disposeObject3D(botEntry.mesh);
    botEntry.mesh = modelScene;
    scene.add(modelScene);
    botEntry.animatedCharacter = createAnimatedCharacter(modelScene, animations, BOT_MODEL.clips);
  });
}

// Swaps the placeholder box for the real weapon once it arrives. Same
// non-blocking shape as the bot models: a failed load leaves the box in
// place and the game stays playable (R18).
loadPropModel(assetUrl(WEAPON_MODEL.path), {
  onError: (error) => console.warn('Failed to load weapon model:', error),
}).then((model) => {
  if (!model) return;
  weaponView.setModel(model, {
    position: new THREE.Vector3(WEAPON_MODEL.offset.x, WEAPON_MODEL.offset.y, WEAPON_MODEL.offset.z),
    scale: new THREE.Vector3(WEAPON_MODEL.scale, WEAPON_MODEL.scale, WEAPON_MODEL.scale),
  });
});

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
  const occupied = buildOccupiedPositions(sim.world.allEntities(), botEntry.id);
  // R11/AE3: a ramp reinforcement gets the same LOS-safety filter respawn
  // uses -- this call site previously shipped a spawn-on-player bug
  // (744f7de/aadeb8c) from skipping exactly this kind of check.
  const spawn = selectSpawnPoint(arena.rapierWorld, arena.spawnPoints, {
    enemyPositions: occupied,
    occupiedPositions: occupied,
  });
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
  onRestart: () => {
    resetMatch(sim.world, {
      rapierWorld: arena.rapierWorld,
      spawnPoints: arena.spawnPoints,
      movementSystem,
      healthSystem,
      pickupSystem,
      grenadeSystem,
      killfeed,
    });
    // resetMatch repositions every entity in the world, including bots the
    // ramp hadn't unlocked yet -- re-park those so the new match starts the
    // ramp over instead of carrying over the previous match's bot count.
    matchElapsedSeconds = 0;
    parkBotsBeyondRampCount();
    // KTD5: bot AI (phase, last-seen memory, search dwell, nav path) is
    // otherwise a persistent closure that outlives the match it was built
    // for -- reinitialize every bot's, not just the entities they drive.
    for (const botEntry of bots) botEntry.bot.reset();
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
  // Directly repositions an entity, mirroring the same movementSystem.teleport
  // call activateBot/deactivateBot already use for a real gameplay reason --
  // here so automated verification can reach a specific pickup or room
  // without solving pathfinding through the corridor layout by hand.
  window.__debugTeleportEntity = (entityId, position) => {
    sim.world.getEntity(entityId).position = { ...position };
    movementSystem.teleport(entityId, position);
  };
  // Directly grants an entity's grenade pocket, so automated verification can
  // reach the throw/blast path without first walking a corner-room pickup
  // route -- same rationale as __debugSetScore above.
  window.__debugGrantGrenades = (entityId, count) => {
    sim.world.getEntity(entityId).grenadeCount = count;
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
// Not pointer-lock-gated, unlike mousedown above: pointer lock can exit
// (e.g. Esc) while the button is still physically held, and the real
// mouseup that eventually follows must still clear the held-fire level --
// gating it the same way as mousedown would leave fireHeld stuck true
// across a resumed session.
document.addEventListener('mouseup', (event) => {
  if (event.button === 0) inputSampler.onFireReleased();
});
// Pointer-lock-gated like mousedown above, for the same reason: an edge-
// latched action key (currently only G/throw) reaching the sampler while
// paused or at a menu would queue a press that fires the instant play
// resumes, with no input from the player at that moment.
document.addEventListener('keydown', (event) => {
  if (document.pointerLockElement === renderer.domElement) {
    inputSampler.onKeyDown(event);
  }
});
// Not pointer-lock-gated, unlike keydown above -- mirrors mouseup: a key
// released after pointer lock has already dropped must still clear `keys`,
// or it reads as held forever (window.blur below covers the alt-tab case,
// where no keyup event arrives at all).
document.addEventListener('keyup', (event) => inputSampler.onKeyUp(event));
// The browser delivers no keyup/mouseup to a window that loses focus, so a
// physically-held key or button would otherwise stay latched and resume
// acting -- auto-walk, an unintended throw -- the instant focus returns.
window.addEventListener('blur', () => inputSampler.clearHeldInput());

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
    // Audio tracks run state, not the early return below: a shot still
    // sounding when the player hits Esc has to be cut off, and that decision
    // has to be made on the frames where the sim is *not* running (R11).
    const simRunning = gameShell.isSimRunning();
    gunshots.setRunning(simRunning);

    // The scene still renders every frame regardless (render/loop.js calls
    // renderer.render after this returns), so start/pause/results screens
    // show over a frozen last-playing frame rather than a blank canvas.
    if (!simRunning) return;

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

    // Resolved up front because the impact spark's colour depends on whether
    // the shot landed on someone, and the 'hit' event that says so is pushed
    // after the 'fire' event it belongs to.
    const landedShooters = shooterIdsThatHit(events);

    for (const event of events) {
      if (event.type === 'fire' && event.shooterId === LOCAL_PLAYER_ID) {
        weaponView.fire();
        // R10: MG shots sound distinct from pistol shots -- resolved from
        // the shooter's *current* heldWeapon, which is accurate for every
        // shot except the one that empties the last round (weapon.js's
        // auto-revert already flipped it back to 'pistol' by the time this
        // event is read); a one-shot cosmetic edge case, not a correctness
        // one.
        gunshots.playLocal(sim.world.getEntity(event.shooterId)?.heldWeapon);
        if (debugMode) debugCounters.fires += 1;
      }
      if (event.type === 'fire') {
        bots.find((b) => b.id === event.shooterId)?.animatedCharacter?.playFireReaction();
        tracers.spawn(event.origin, event.endPoint);
        impacts.spawn(event.endPoint, landedShooters.has(event.shooterId) ? 'body' : 'surface');
        // event.origin is the shooter's own eye position, so it doubles as
        // where the shot should be heard from.
        if (event.shooterId !== LOCAL_PLAYER_ID) {
          gunshots.playAt(event.origin, sim.world.getEntity(event.shooterId)?.heldWeapon);
        }
      }
      if (event.type === 'hit' && event.shooterId === LOCAL_PLAYER_ID) {
        hud.flashCrosshair(event.killed ? 'kill' : 'hit');
        if (debugMode) debugCounters.crosshairFlashes += 1;
      }
      // R1, R3, R5: every kill narrates the feed, bot-vs-bot included; a
      // non-lethal hit is a no-op (addEntry checks event.killed itself).
      // Two blast kills in the same events array each call this in turn, so
      // they land as adjacent newest-first lines without any batching logic
      // here (AE2).
      if (event.type === 'hit') killfeed.addKill(event);
      if (event.type === 'hit' && event.targetId === LOCAL_PLAYER_ID && event.damageOrigin) {
        const angle = computeAngleFromPlayer(
          playerEntity.latest.position,
          playerEntity.latest.yaw,
          event.damageOrigin
        );
        damageIndicator.show(angle);
        if (debugMode) debugCounters.damageIndicatorShows += 1;
      }
      // R11: visible burst plus light flash, and an audible blast -- U4's
      // grenades.js pushes exactly one 'explosion' event per detonation, so
      // "once per blast" falls out of iterating events once rather than
      // needing dedup logic here.
      if (event.type === 'explosion') {
        grenadeFX.spawnExplosion(event.position);
        gunshots.playExplosion(event.position);
      }
    }

    // Layered on top of the simulation's pitch, which was applied above and
    // is what hitscans actually resolve against -- so the jolt is visible
    // but the shot still lands where the crosshair was (R5, R17).
    camera.rotation.x -= weaponView.getCameraKick();

    // R10: shows whichever weapon the local player currently holds --
    // cheap no-op internally when unchanged from last frame.
    weaponView.setHeldWeapon(playerEntity.heldWeapon);
    weaponView.update(delta);
    tracers.update(delta);
    impacts.update(delta);
    pickupMeshes.update(pickupSystem.getPickupStates());
    grenadeFX.syncInFlight(grenadeSystem.getInFlightGrenades());
    grenadeFX.update(delta);
    hud.update({
      health: playerEntity.health,
      score: playerEntity.score,
      dead: playerEntity.dead,
      respawnSecondsRemaining: healthSystem.getRespawnTicksRemaining(LOCAL_PLAYER_ID) * sim.dt,
      ammo: playerEntity.ammo,
      grenadeCount: playerEntity.grenadeCount,
    });
    // R4, R8, KTD2: ages/expires entries by sim delta time, only reached
    // from this simRunning block -- a paused match calls this zero times,
    // freezing the feed for free, no separate pause check needed.
    killfeed.update(delta);
    // Latest non-interpolated transform, same as the camera above (KTD2) --
    // the map should react exactly as fast as aiming does, not lag a frame
    // behind it.
    minimap.update(playerEntity.latest.position, playerEntity.latest.yaw);

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
