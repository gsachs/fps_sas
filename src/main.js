import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene, loadSkyBackground, applyShadowQuality } from './render/scene.js';
import { createRenderLoop } from './render/loop.js';
import { createPostFX } from './render/postfx.js';
import { buildArenaMeshes } from './render/arenaMesh.js';
import { createArena } from './arena/arena.js';
import { selectSpawnPoint } from './arena/spawnPlacement.js';
import { createSimulation } from './sim/index.js';
import { createMovementSystem, EYE_HEIGHT, CAPSULE_GROUND_OFFSET } from './sim/movement.js';
import { createWeaponSystem, MACHINEGUN_WEAPON_ID } from './sim/weapon.js';
import { createHealthSystem } from './sim/health.js';
import { createPickupSystem } from './sim/pickups.js';
import { createGrenadeSystem } from './sim/grenades.js';
import { createBotAI } from './sim/bot/fsm.js';
import { getActiveBotCount, buildOccupiedPositions } from './shell/botRamp.js';
import { createInputSampler } from './input/sampler.js';
import { createCharacterMesh, computeBotMeshYaw, computeBotMeshY, computeCameraYaw } from './render/entityMesh.js';
import { loadCharacterModel, loadPropModel, disposeObject3D } from './render/models.js';
import {
  BOT_MODEL,
  MACHINEGUN_MODEL,
  MACHINEGUN_GUNSHOT_PATHS,
  EXPLOSION_PATHS,
  SKY_TEXTURE_PATH,
} from './render/modelAssets.js';
import { createAnimatedCharacter } from './render/mixer.js';
import { createHud } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { createKillfeed } from './ui/killfeed.js';
import { LOCAL_PLAYER_ID } from './sim/entityIds.js';
import { createDamageIndicator } from './render/feedback.js';
import { createWeaponView, WEAPON_LAYER } from './render/weaponView.js';
import { createTracerSystem } from './render/tracer.js';
import { createImpactSystem } from './render/impacts.js';
import { createDecalSystem } from './render/decals.js';
import { createCorpseField } from './render/corpses.js';
import { createDropshipFleet } from './render/dropships.js';
import { attractCameraPose, ATTRACT_ORBIT } from './render/attractCamera.js';
import { createPickupMeshes } from './render/pickupMeshes.js';
import { createGrenadeFX } from './render/grenadeFX.js';
import { createGunshotAudio, EXPLOSION_SOUND_SET_ID } from './audio/gunshots.js';
import { createGameShell, STATES } from './shell/states.js';
import { browserStorage, readShadowQuality, writeShadowQuality } from './shell/graphicsSettings.js';
import { checkMatchEnd, resetMatch } from './shell/matchEnd.js';
import { renderStartupError } from './shell/startupError.js';
import { raceInitWithTimeout, InitTimeoutError } from './shell/initTimeout.js';
import { installDebugHooks } from './debug/testHooks.js';
import { applyFrameEvents } from './render/frameEvents.js';
import { gatherCommands } from './sim/gatherCommands.js';

// The composition root: boots the renderer, physics, and sim, wires every
// render/HUD/audio system to the sim's per-frame events, and starts the
// game loop. Everything else in src/ is a system this file assembles --
// none of them know about each other directly.
try {
  await raceInitWithTimeout(() => RAPIER.init());
} catch (error) {
  console.error('RAPIER.init failed:', error);
  const message =
    error instanceof InitTimeoutError
      ? 'Physics engine timed out loading. Reload to try again.'
      : 'Physics engine failed to load. Reload to try again.';
  renderStartupError(document.getElementById('app'), message);
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

// The player's stored graphics choice, resolved before the scene is built
// so the shadow map is allocated at the right size once rather than being
// reallocated on the first frame.
const shadowQualityStorage = browserStorage();
const shadowQuality = readShadowQuality(shadowQualityStorage);
const { scene, camera, sun, skyAmbient } = createScene({
  aspect: window.innerWidth / window.innerHeight,
  shadowQuality,
});

// U1: composer chain (AO, bloom, anti-alias, tone map) that replaces the
// direct renderer.render() call below -- OutputPass at its end reads
// `renderer.toneMapping`/`toneMappingExposure` as set above, so the ACES
// look carries through unchanged; no separate exposure wiring needed here.
const postfx = createPostFX({ renderer, scene, camera, width: window.innerWidth, height: window.innerHeight });

const arena = createArena();
// Captured (not just added) so the decal system below has a target group to
// raycast against -- raycasting the whole scene instead would also hit
// bots, the weapon viewmodel, tracers, impacts, pickups, and decals
// themselves, none of which should ever be decal-raycast targets.
const arenaMeshes = buildArenaMeshes(arena);
scene.add(arenaMeshes);

// BASE_URL-relative, not a hard-coded leading slash: this must resolve
// correctly when deployed under a subpath (e.g. a GitHub Pages project
// page), not just when served from a host's root.
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;

// U5/KTD5/R7: swaps in the real sky once loaded; scene.background and
// scene.fog already share SKY_COLOR (createScene), so a slow or failed load
// stays seamless rather than reverting to a visibly different placeholder.
loadSkyBackground(scene, assetUrl(SKY_TEXTURE_PATH), {
  onError: (error) => console.warn('Failed to load sky background:', error),
});

const hud = createHud(app);
// R8: joins the app container ahead of the shell screens created below (see
// createGameShell) so it paints underneath them and inherits their overlay
// coverage for free, the same way the rest of the HUD does.
const killfeed = createKillfeed(app);
const minimap = createMinimap(app, arena);
const damageIndicator = createDamageIndicator(app);
const weaponView = createWeaponView(camera);
// U2/KTD4: registers the viewmodel's depth-cleared pass now that its weapon
// camera exists -- postfx.js reserved the composer slot for it at
// construction, before weaponView existed to hand it a camera.
postfx.addWeaponPass(weaponView.weaponCamera);
// Live-verified gap: the viewmodel moved to its own render layer (KTD4) but
// the sun and sky ambient never followed -- their .layers default to layer
// 0 only, so the weapon read as a flat, unlit silhouette between shots
// (only the muzzle flash's own light was ever enabled on both layers).
// Purely additive -- adds layer-1 visibility to lights whose behaviour on
// the world (layer 0) is untouched, so R10 holds.
sun.layers.enable(WEAPON_LAYER);
skyAmbient.layers.enable(WEAPON_LAYER);
const tracers = createTracerSystem(scene);
const impacts = createImpactSystem(scene);
const decals = createDecalSystem(scene, arenaMeshes);
// Bodies outlive the bot that left them, so they cannot be the bot's own
// mesh; corpses.js explains why. Handed the same rig description the live
// bots use, so a body is the same character at the same size and facing.
// The drone that delivered an arriving bot. Cosmetic only -- see
// dropships.js for why this one is render-layer while the fall it
// accompanies has to be simulation.
const dropships = createDropshipFleet(scene);
const corpses = createCorpseField(scene, {
  modelUrl: assetUrl(BOT_MODEL.path),
  model: {
    scale: BOT_MODEL.scale,
    clips: BOT_MODEL.clips,
    yawOffset: BOT_MODEL.yawOffset,
    // Same feet-vs-centre origin correction the live bots apply, for the
    // same reason: without it the body floats a capsule's height off the
    // floor it is supposed to be lying on.
    yOffset: -CAPSULE_GROUND_OFFSET,
  },
  onError: (error) => console.warn('Failed to load corpse model:', error),
});
const pickupMeshes = createPickupMeshes(scene, arena.pickups);
const grenadeFX = createGrenadeFX(scene);
const gunshots = createGunshotAudio({
  camera,
  scene,
  // R4: the machine gun and the explosion each play through their own real
  // sample pool -- a set with no load yet (or a failed one) falls back to
  // the default pool inside gunshots.js itself, so this is purely additive.
  soundSetUrls: {
    [MACHINEGUN_WEAPON_ID]: MACHINEGUN_GUNSHOT_PATHS.map(assetUrl),
    [EXPLOSION_SOUND_SET_ID]: EXPLOSION_PATHS.map(assetUrl),
  },
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
  tickAirdrops: healthSystem.tickAirdrops,
};

// R7: grenade pickups are player-only -- pickups.js has no concept of a
// local-player id of its own, so this predicate is the seam that decides
// eligibility without leaking a render/DOM concern into the sim layer.
const pickupSystem = createPickupSystem({
  pickups: arena.pickups,
  isLocalPlayer: (entity) => entity.id === LOCAL_PLAYER_ID,
});
const grenadeSystem = createGrenadeSystem({ rapierWorld: arena.rapierWorld, healthSystem, movementSystem });
const BOT_COUNT = 6; // KTD6: scaled for the bigger arena's contact density (R8)
// Reinforcements not yet unlocked by the ramp (shell/botRamp.js) sit parked
// here -- far enough below the arena that no hitscan ray reaches them
// (HITSCAN_MAX_DISTANCE is 100; the ground collider blocks a downward ray
// long before then anyway) -- rather than being removed from the sim, which
// has no entity-removal path (KTD2's entity store is add-only).
const PARK_POSITION = { x: 0, y: -100, z: 0 };
let matchElapsedSeconds = 0;
let lastRenderState = [];

// gatherCommands (sim/gatherCommands.js) closes over `sim` and `bots`
// before either is assigned -- safe because the arrow function below only
// *runs* later, from sim.tick() in the render loop, by which point both
// exist (bots need sim.world to add entities to, so they can't be built
// before sim exists). `bots` is a `const` array only ever mutated via
// .push(), so the same reference stays valid across pushes.
const sim = createSimulation({
  physics: movementSystem,
  combat,
  pickups: pickupSystem,
  grenades: grenadeSystem,
  gatherCommands: () => gatherCommands({ sim, bots, inputSampler }),
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
    if (!result.loaded) return;
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

// Swaps a placeholder box for a real weapon model once it arrives, through
// weaponView.js's setModel(model, transform, weaponId) seam (R3). Same
// non-blocking shape as the bot models: a failed load leaves the box in
// place and the game stays playable (R18).
function loadWeaponModel(model, label, weaponId) {
  loadPropModel(assetUrl(model.path), {
    onError: (error) => console.warn(`Failed to load ${label} model:`, error),
  }).then((result) => {
    if (!result.loaded) return;
    weaponView.setModel(
      result.scene,
      {
        position: new THREE.Vector3(model.offset.x, model.offset.y, model.offset.z),
        scale: new THREE.Vector3().setScalar(model.scale),
      },
      weaponId
    );
  });
}
loadWeaponModel(MACHINEGUN_MODEL, 'machine-gun', MACHINEGUN_WEAPON_ID);

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
  // Dropped in, the same way a respawn arrives -- a reinforcement that
  // simply appeared standing on the floor was the other half of what read as
  // bots materialising out of nowhere.
  healthSystem.beginAirdrop(sim.world.getEntity(botEntry.id), spawn);
  botEntry.mesh.visible = true;
  botEntry.active = true;
}

function deactivateBot(botEntry) {
  const entity = sim.world.getEntity(botEntry.id);
  entity.position = { ...PARK_POSITION };
  entity.airdropping = false; // parking cancels an arrival in progress
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
  postfx.setSize(window.innerWidth, window.innerHeight);
});

const gameShell = createGameShell({
  container: app,
  lockElement: renderer.domElement,
  shadowQuality,
  onShadowQualityChange: (quality) => {
    writeShadowQuality(shadowQualityStorage, quality);
    applyShadowQuality(sun, quality);
  },
  // U24: Escape is the common way this game pauses (it exits pointer lock,
  // which the shell turns into a PLAYING -> PAUSED transition) -- mirrors
  // the window-blur listener below, which covers the alt-tab case instead.
  onPause: () => inputSampler.clearHeldInput(),
  onRestart: () => {
    resetMatch(sim.world, {
      rapierWorld: arena.rapierWorld,
      spawnPoints: arena.spawnPoints,
      movementSystem,
      healthSystem,
      pickupSystem,
      grenadeSystem,
      killfeed,
      decals,
      corpses,
      dropships,
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
  installDebugHooks({
    sim,
    bots,
    debugCounters,
    camera,
    inputSampler,
    movementSystem,
    gameShell,
    scene,
    botCount: BOT_COUNT,
    getMatchElapsedSeconds: () => matchElapsedSeconds,
    getLastRenderState: () => lastRenderState,
  });
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
let attractElapsedSeconds = 0;
let victoryElapsedSeconds = 0;

const loop = createRenderLoop({
  render: (delta) => postfx.composer.render(delta),
  onFrame(delta) {
    // Audio tracks run state, not the early return below: a shot still
    // sounding when the player hits Esc has to be cut off, and that decision
    // has to be made on the frames where the sim is *not* running (R11).
    const simRunning = gameShell.isSimRunning();
    gunshots.setRunning(simRunning);

    // The player's own instruments -- their gun and their map -- belong to a
    // player who is in the match. At the start screen the camera is orbiting
    // the site from above, and a first-person weapon hanging in the corner of
    // that shot reads as a bug. Paused and results keep them, because those
    // screens sit over a frozen frame of real play.
    const inMenu =
      gameShell.getState() === STATES.START || gameShell.getState() === STATES.RESULTS;
    weaponView.setVisible(!inMenu);
    minimap.setVisible(!inMenu);
    hud.setVisible(!inMenu);

    // The scene still renders every frame regardless (render/loop.js calls
    // renderer.render after this returns), so start/pause/results screens
    // show over a frozen last-playing frame rather than a blank canvas.
    if (!simRunning) {
      // ...except at the start screen, where there is no last-playing frame
      // to freeze. Left alone the camera sits at the renderer's default pose
      // -- the origin, at floor level -- and since the ground plane is
      // single-sided, half the first screen anyone sees is the underside of
      // the world. Orbit the site instead: it is the thing the brief is
      // asking the player to go and secure. Paused and results keep their
      // frozen frame, which is the right backdrop for both.
      if (gameShell.getState() === STATES.START) {
        attractElapsedSeconds += delta;
        const pose = attractCameraPose(attractElapsedSeconds);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
      } else if (gameShell.getState() === STATES.RESULTS) {
        // A finished match lifts out of the player's own eyes and orbits the
        // site; on a win, the landing flies in over it (see the match-end
        // branch below). The sim is stopped, so nothing here moves except the
        // camera and the craft -- which is why this can run at all on a frame
        // the simulation is not stepping.
        victoryElapsedSeconds += delta;
        dropships.update(delta);
        const pose = attractCameraPose(victoryElapsedSeconds);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
      }
      return;
    }

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

    applyFrameEvents(events, {
      weaponView,
      gunshots,
      debugMode,
      debugCounters,
      bots,
      tracers,
      impacts,
      decals,
      sim,
      hud,
      killfeed,
      playerEntity,
      damageIndicator,
      grenadeFX,
      corpses,
    });

    // A punch straight back along the view axis, applied after the camera has
    // been placed from the simulation above. Deliberately a translation and
    // not a rotation: the crosshair is pinned to the centre of the screen, so
    // it points wherever the camera points, and rotating the camera is
    // therefore the same as moving the crosshair off the shot. Translating
    // along the axis the camera already looks down leaves the crosshair ray
    // collinear with the shot, so R5/R17 hold at every range instead of only
    // while the gun is at rest. See weaponView.js's CAMERA_PUNCH_DISTANCE.
    camera.translateZ(weaponView.getCameraPunch());

    // R10: shows whichever weapon the local player currently holds --
    // cheap no-op internally when unchanged from last frame.
    weaponView.setHeldWeapon(playerEntity.heldWeapon);
    weaponView.update(delta);
    tracers.update(delta);
    impacts.update(delta);
    decals.update(delta);
    corpses.update(delta);
    dropships.update(delta);
    pickupMeshes.update(pickupSystem.getPickupStates());
    // Diffed against last frame rather than driven by an event: the sim has
    // no "airdrop started" event, and a purely visual effect is not reason
    // enough to grow one. Mirrors grenadeFX.syncInFlight just below.
    dropships.syncArrivals(sim.world.allEntities());
    grenadeFX.syncInFlight(grenadeSystem.getInFlightGrenades());
    grenadeFX.update(delta);
    hud.update({
      health: playerEntity.health,
      score: playerEntity.score,
      dead: playerEntity.dead,
      respawnSecondsRemaining: healthSystem.getRespawnTicksRemaining(LOCAL_PLAYER_ID) * sim.dt,
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
      gameShell.showResults(matchResult.leaderboard, { durationSeconds: matchElapsedSeconds });
      // Winning is the whole premise paying off -- the site is clear, so the
      // landing it was being held for can finally come down. Only the flight
      // is conditional; the camera lifts either way, because a frozen
      // first-person frame at the end of a lost match is usually a wall or a
      // patch of floor, and the site itself is the better last image of a
      // match however it went.
      if (matchResult.leaderboard[0]?.id === LOCAL_PLAYER_ID) {
        victoryElapsedSeconds = 0;
        dropships.beginVictoryFlight(ATTRACT_ORBIT.CENTRE);
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
