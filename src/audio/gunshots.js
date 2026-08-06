import * as THREE from 'three';
import { DEFAULT_WEAPON_ID, MACHINEGUN_WEAPON_ID } from '../sim/weapon.js';
import { raceInitWithTimeout } from '../shell/initTimeout.js';

// Gunshots for every shooter. The player's own shot plays flat, since it
// happens at the listener and has no direction to convey; every other
// shooter's shot is positioned in the world, so incoming fire can be located
// by ear before the damage indicator confirms it.
const LOCAL_SHOT_VOLUME = 0.6;
const REMOTE_SHOT_VOLUME = 0.8;
// Bots fire ~10 shots/second each and shots overlap, so voices are pooled and
// cycled rather than allocated per shot. Twelve is comfortably more than the
// number of shots that can be audible at once at this fire rate.
const VOICE_POOL_SIZE = 12;
// Linear falloff reaching silence past the arena's far corner: predictable
// across a bounded space, where the default inverse model stays faintly
// audible forever and muddies a busy fight.
const REFERENCE_DISTANCE = 5;
const MAX_DISTANCE = 70;

// KTD8: the gunshot pool has a per-weapon set. U5: both the pistol and the
// machine gun now play through their own real, distinct recordings (see
// modelAssets.js's GUNSHOT_PATHS / MACHINEGUN_GUNSHOT_PATHS and CREDITS.md)
// instead of one set of buffers replayed at a different pitch to fake a
// second weapon -- so every set plays at its own sample's natural rate.
export const WEAPON_SOUND_SETS = {
  [DEFAULT_WEAPON_ID]: { playbackRate: 1 },
  [MACHINEGUN_WEAPON_ID]: { playbackRate: 1 },
};
const DEFAULT_SOUND_SET_ID = DEFAULT_WEAPON_ID; // unheld/unknown weapon ids fall back here

// KTD8: the explosion is not a weapon set (nothing ever "holds" it), so it
// gets its own sibling constant rather than a WEAPON_SOUND_SETS entry --
// pickVariantForSet's per-set cursor works the same either way, keyed by
// this id. U5: now a real explosion recording (modelAssets.js's
// EXPLOSION_PATHS, see CREDITS.md) rather than a gunshot buffer pitched down
// to fake a boom, so it plays at its own sample's natural rate too. Exported
// so a caller building createGunshotAudio's soundSetUrls map (main.js) has
// the real id instead of a raw string.
export const EXPLOSION_SOUND_SET_ID = 'explosion';
export const EXPLOSION_SOUND = { playbackRate: 1 };
// R11: audible information for everyone who hears it, and farther-reaching
// than a gunshot -- louder than REMOTE_SHOT_VOLUME (0.8) and a wider linear
// falloff than gunshots' REFERENCE_DISTANCE/MAX_DISTANCE (5/70).
const EXPLOSION_VOLUME = 1.4;
const EXPLOSION_REFERENCE_DISTANCE = 12;
const EXPLOSION_MAX_DISTANCE = 140;

// U28: a URL that never calls back at all -- a stalled connection, a
// silently-dropped proxy response -- isn't the explicit-failure case the
// loader's error callback already handles below; it just leaves that one
// promise pending forever. Promise.all only settles once every element does,
// so one hung load leaves that URL's whole set's pool empty for the rest of
// the session, and every future playLocal/playAt/playExplosion call for that
// set falls back to the default pool (or, if the default set itself is the
// one that hung, does nothing) with nothing logged. Racing each URL's own
// load against this timeout (reusing initTimeout.js's pattern, already
// proven for RAPIER.init) bounds the worst case to one dropped sample
// instead of session-long silence. Shorter than initTimeout's own default:
// these are small audio assets, not a WASM payload. Not product-specified --
// a defensible default.
export const BUFFER_LOAD_TIMEOUT_MS = 8_000;

// Which named set a weapon id's shot plays through -- unknown ids (or none,
// e.g. a caller that hasn't resolved a shooter yet) fall back to the pistol
// set rather than throwing, matching the "never pass null, degrade
// gracefully" shape the rest of this module already follows.
export function resolveSoundSet(weaponId) {
  return WEAPON_SOUND_SETS[weaponId] ? weaponId : DEFAULT_SOUND_SET_ID;
}

// Which sample to play next, never the one just played. A single sample
// repeating ten times a second is what makes automatic fire sound like a
// buzzer rather than a weapon. `roll` is a 0..1 value supplied by the caller,
// so the choice is deterministic and testable.
export function nextVariantIndex(previousIndex, variantCount, roll) {
  if (variantCount <= 1) return 0;
  if (previousIndex < 0) return Math.min(Math.floor(roll * variantCount), variantCount - 1);

  // Choose among every variant except the previous one, then shift past it.
  const candidates = variantCount - 1;
  const picked = Math.min(Math.floor(roll * candidates), candidates - 1);
  return picked >= previousIndex ? picked + 1 : picked;
}

// Advances and reads back `setId`'s own "don't repeat" cursor inside the
// shared `cursorsBySetId` map -- pulled out of the stateful factory below so
// that the per-set independence (the MG cycling its own samples never
// perturbs the pistol's cursor, or vice versa, even when calls interleave)
// is testable without the real browser audio APIs the factory needs.
export function pickVariantForSet(cursorsBySetId, setId, variantCount, roll) {
  const previous = cursorsBySetId.get(setId) ?? -1;
  const index = nextVariantIndex(previous, variantCount, roll);
  cursorsBySetId.set(setId, index);
  return index;
}

// Whether the audio context needs changing to match the game's run state.
// Returns null when it already matches, so the render loop can call this every
// frame without issuing redundant promises. Extracted because a stuck context
// is silent in exactly the way that looks like "audio was never wired up".
export function audioContextAction(contextState, shouldPlay) {
  if (shouldPlay && contextState === 'suspended') return 'resume';
  if (!shouldPlay && contextState === 'running') return 'suspend';
  return null;
}

// U5: each named sound set (the pistol's DEFAULT_SOUND_SET_ID entry, the
// machine gun's own MACHINEGUN_WEAPON_ID entry, the explosion's own
// EXPLOSION_SOUND_SET_ID entry) now loads its own buffer pool instead of
// every set replaying the pistol's -- this is the seam a real sample drops
// into. `soundSetUrls` is keyed by set id and every entry is optional: a set
// with no entry here (or whose own load comes back empty -- absent files, a
// network failure, U28's stall timeout) falls back to playing through
// DEFAULT_SOUND_SET_ID's pool rather than staying silent, the same
// "degrade gracefully, never throw" contract resolveSoundSet already holds
// for an unknown weapon id.
export function createGunshotAudio({ camera, scene, soundSetUrls = {}, onError }) {
  const listener = new THREE.AudioListener();
  camera.add(listener);

  const buffersBySetId = new Map(); // setId -> AudioBuffer[], each set's own pool
  let localVoice = null;
  const positionalVoices = [];
  // KTD8: unpooled -- one dedicated voice, constructed once and never cycled
  // through positionalVoices, so an explosion is never silently dropped or
  // stolen by gunfire competing for the same pool.
  let explosionVoice = null;
  const cursorsBySetId = new Map(); // KTD8: each named sound set cycles its own don't-repeat pointer
  let voiceCursor = 0;
  // Browsers refuse to start an audio context outside a user gesture, so
  // nothing is resumed until the click-to-play gesture calls unlock(). Until
  // then setRunning() stays out of the way rather than firing resume() calls
  // the browser will reject every frame.
  let unlocked = false;
  // Set once a resume() attempt rejects, so setRunning (called every frame
  // while unlocked) stops re-issuing it -- without this, a context stuck
  // suspended (e.g. Chrome's auto-suspend-on-inactivity policy resuming
  // from a rAF callback rather than a user gesture) fires a fresh promise
  // every frame forever, each rejection silently discarded. Cleared only by
  // a fresh unlock() gesture, which gets its own attempt.
  let resumeFailed = false;

  const loader = new THREE.AudioLoader();

  // Loads one set's own buffer pool. A failed or stalled URL (U28) never
  // rejects the whole pool -- it drops out via the same null-sentinel filter
  // every other loader in this codebase uses, so one bad file in a set costs
  // that one variant, not the set.
  function loadBufferPool(setUrls) {
    return Promise.all(
      setUrls.map((url) =>
        raceInitWithTimeout(
          () => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject)),
          BUFFER_LOAD_TIMEOUT_MS
        ).catch((error) => {
          // An explicit loader failure and a load that stalled past the
          // timeout both land here as a rejection -- one reporting path for
          // both, resolving to the same null sentinel the filter below
          // expects.
          onError?.(error);
          return null;
        })
      )
    ).then((loaded) => loaded.filter(Boolean));
  }

  Promise.all(
    Object.entries(soundSetUrls).map(([setId, setUrls]) => loadBufferPool(setUrls).then((pool) => [setId, pool]))
  ).then((entries) => {
    for (const [setId, pool] of entries) buffersBySetId.set(setId, pool);

    // A failed default-set load leaves the game silent but entirely playable
    // -- the same contract the model loaders hold (R18). Every other set's
    // own pool can be empty without blocking voice construction: pickBuffer
    // below falls back to the default pool for those.
    if ((buffersBySetId.get(DEFAULT_SOUND_SET_ID) ?? []).length === 0) return;

    localVoice = new THREE.Audio(listener);
    for (let i = 0; i < VOICE_POOL_SIZE; i++) {
      const voice = new THREE.PositionalAudio(listener);
      voice.setDistanceModel('linear');
      voice.setRefDistance(REFERENCE_DISTANCE);
      voice.setMaxDistance(MAX_DISTANCE);
      scene.add(voice);
      positionalVoices.push(voice);
    }

    explosionVoice = new THREE.PositionalAudio(listener);
    explosionVoice.setDistanceModel('linear');
    explosionVoice.setRefDistance(EXPLOSION_REFERENCE_DISTANCE);
    explosionVoice.setMaxDistance(EXPLOSION_MAX_DISTANCE);
    scene.add(explosionVoice);
  });

  // `setId`'s own pool if it loaded anything, otherwise the default/pistol
  // pool -- a weapon whose own sample hasn't landed (no URLs passed yet, a
  // failed fetch) plays the default set's sample rather than nothing, the
  // same "unknown falls back to pistol" shape resolveSoundSet already uses
  // one layer up.
  function pickBuffer(setId) {
    const ownPool = buffersBySetId.get(setId);
    const pool = ownPool && ownPool.length > 0 ? ownPool : (buffersBySetId.get(DEFAULT_SOUND_SET_ID) ?? []);
    const index = pickVariantForSet(cursorsBySetId, setId, pool.length, Math.random());
    return pool[index];
  }

  // `weaponId` resolves which named set (and its playback rate) this shot
  // plays through -- the caller (main.js) already has the shooter entity on
  // hand via the fire event and passes its heldWeapon straight through.
  function playLocal(weaponId) {
    if (!localVoice) return;
    const setId = resolveSoundSet(weaponId);
    if (localVoice.isPlaying) localVoice.stop();
    localVoice.setBuffer(pickBuffer(setId));
    localVoice.setPlaybackRate(WEAPON_SOUND_SETS[setId].playbackRate);
    localVoice.setVolume(LOCAL_SHOT_VOLUME);
    localVoice.play();
  }

  function playAt(position, weaponId) {
    if (positionalVoices.length === 0) return;
    const setId = resolveSoundSet(weaponId);
    const voice = positionalVoices[voiceCursor];
    voiceCursor = (voiceCursor + 1) % positionalVoices.length;
    if (voice.isPlaying) voice.stop();
    voice.position.set(position.x, position.y, position.z);
    voice.setBuffer(pickBuffer(setId));
    voice.setPlaybackRate(WEAPON_SOUND_SETS[setId].playbackRate);
    voice.setVolume(REMOTE_SHOT_VOLUME);
    voice.play();
  }

  // KTD8: the explosion's one-shot positional buffer -- no weaponId, since
  // nothing holds an explosion; position is the blast center (grenades.js's
  // event already carries it, so no owner lookup is needed the way playAt's
  // weaponId is).
  function playExplosion(position) {
    if (!explosionVoice) return;
    explosionVoice.position.set(position.x, position.y, position.z);
    if (explosionVoice.isPlaying) explosionVoice.stop();
    explosionVoice.setBuffer(pickBuffer(EXPLOSION_SOUND_SET_ID));
    explosionVoice.setPlaybackRate(EXPLOSION_SOUND.playbackRate);
    explosionVoice.setVolume(EXPLOSION_VOLUME);
    explosionVoice.play();
  }

  // Call from a real user gesture -- the click-to-play/resume click.
  function unlock() {
    unlocked = true;
    resumeFailed = false; // a fresh gesture earns resume() a fresh attempt
    if (listener.context.state !== 'running') {
      listener.context.resume().catch((error) => onError?.(error));
    }
  }

  // Keeps audio in step with the game's run state, so a shot in flight is cut
  // off by a pause instead of playing on over the pause overlay.
  function setRunning(shouldPlay) {
    if (!unlocked) return;
    const action = audioContextAction(listener.context.state, shouldPlay);
    if (action === 'resume') {
      if (resumeFailed) return;
      listener.context.resume().catch((error) => {
        resumeFailed = true;
        onError?.(error);
      });
    }
    if (action === 'suspend') listener.context.suspend().catch(() => {});
  }

  return { playLocal, playAt, playExplosion, unlock, setRunning };
}
