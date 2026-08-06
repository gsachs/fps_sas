import * as THREE from 'three';

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

// KTD8: the gunshot pool gains a per-weapon set. No new samples exist for
// the machine gun yet (that's an asset-sourcing concern, U5) -- its set
// reuses the same pistol buffers at a distinct pitch, which is enough to
// read as a different weapon until a real sample lands through the same
// `urls` seam.
export const WEAPON_SOUND_SETS = {
  pistol: { playbackRate: 1 },
  machinegun: { playbackRate: 1.6 },
};
const DEFAULT_SOUND_SET_ID = 'pistol'; // unheld/unknown weapon ids fall back here

// KTD8: the explosion is not a weapon set (nothing ever "holds" it), so it
// gets its own sibling constant rather than a WEAPON_SOUND_SETS entry --
// pickVariantForSet's per-set cursor works the same either way, keyed by
// this id. Pitched well below the pistol's 1.0 (and the MG's 1.6) so the
// same shared gunshot buffers read as a boom, not a shot -- the identical
// pitched-placeholder trick U2 validated for the MG, applied here until a
// real explosion sample lands (see CREDITS.md).
const EXPLOSION_SOUND_SET_ID = 'explosion';
export const EXPLOSION_SOUND = { playbackRate: 0.45 };
// R11: audible information for everyone who hears it, and farther-reaching
// than a gunshot -- louder than REMOTE_SHOT_VOLUME (0.8) and a wider linear
// falloff than gunshots' REFERENCE_DISTANCE/MAX_DISTANCE (5/70).
const EXPLOSION_VOLUME = 1.4;
const EXPLOSION_REFERENCE_DISTANCE = 12;
const EXPLOSION_MAX_DISTANCE = 140;

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

export function createGunshotAudio({ camera, scene, urls, onError }) {
  const listener = new THREE.AudioListener();
  camera.add(listener);

  let buffers = [];
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
  Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          loader.load(url, resolve, undefined, (error) => {
            onError?.(error);
            resolve(null);
          });
        })
    )
  ).then((loaded) => {
    // A failed load leaves the game silent but entirely playable -- the same
    // contract the model loaders hold (R18).
    buffers = loaded.filter(Boolean);
    if (buffers.length === 0) return;

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

  function pickBuffer(setId) {
    const index = pickVariantForSet(cursorsBySetId, setId, buffers.length, Math.random());
    return buffers[index];
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
    if (listener.context.state !== 'running') listener.context.resume().catch(() => {});
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
