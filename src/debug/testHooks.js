import * as THREE from 'three';
import { LOCAL_PLAYER_ID } from '../sim/entityIds.js';
import { getActiveBotCount } from '../shell/botRamp.js';

// Exists so automated/manual verification can read sim, bot, and shell state
// through window.__debug* hooks without any gameplay code depending on them.
export function installDebugHooks({
  sim,
  bots,
  debugCounters,
  camera,
  inputSampler,
  movementSystem,
  gameShell,
  scene,
  botCount,
  getMatchElapsedSeconds,
  getLastRenderState,
}) {
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
  // reach the throw/blast path without first walking a district pickup
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
  // Sweeps the shadow rig's tuning values on the live scene without a
  // reload, so a candidate value can be compared against the current one in
  // the actual renderer. Shadow defects here are all of the kind no unit
  // test can see -- a shadow lifted off its caster, acne on a lit floor --
  // so the only honest way to choose these numbers is to render them side by
  // side, and doing that a value at a time through source edits is slow
  // enough that it does not get done. Mirrors scene.js's own reallocation:
  // a new mapSize or near/far is ignored until the old depth target goes.
  window.__debugShadowTune = (opts) => {
    const sun = scene.children.find((child) => child.isDirectionalLight);
    if (opts.bias !== undefined) sun.shadow.bias = opts.bias;
    if (opts.normalBias !== undefined) sun.shadow.normalBias = opts.normalBias;
    if (opts.near !== undefined) sun.shadow.camera.near = opts.near;
    if (opts.far !== undefined) sun.shadow.camera.far = opts.far;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  };
  // Shadow state has now gone silently wrong three times here -- an extent
  // hardcoded to a retired arena, a sun standing too close for its own near
  // plane, and a depth bias that grew with the camera's span until it lifted
  // every wall's shadow off its base. None of them looked like anything but
  // "that wall seems to be floating". This reports the numbers directly so
  // they can be read rather than judged by eye.
  window.__debugShadowCamera = () => {
    const sun = scene.children.find((child) => child.isDirectionalLight);
    const { near, far, right, top } = sun.shadow.camera;
    return {
      mapSize: sun.shadow.mapSize.width,
      lightDistance: sun.position.length(),
      near,
      far,
      extent: right,
      squareExtent: right === top,
    };
  };
  // Reports the bot ramp's live state, for verifying reinforcements unlock
  // over a match without waiting out the real ramp interval by hand.
  window.__debugBotRamp = () => ({
    matchElapsedSeconds: getMatchElapsedSeconds(),
    activeCount: bots.filter((b) => b.active).length,
    targetCount: getActiveBotCount(getMatchElapsedSeconds(), botCount),
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
      rendered: getLastRenderState().find((e) => e.id === b.id)?.position,
      raw: sim.world.getEntity(b.id)?.position,
    }));
}
