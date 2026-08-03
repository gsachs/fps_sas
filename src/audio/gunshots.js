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
  let previousVariant = -1;
  let voiceCursor = 0;
  // Browsers refuse to start an audio context outside a user gesture, so
  // nothing is resumed until the click-to-play gesture calls unlock(). Until
  // then setRunning() stays out of the way rather than firing resume() calls
  // the browser will reject every frame.
  let unlocked = false;

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
  });

  function pickBuffer() {
    previousVariant = nextVariantIndex(previousVariant, buffers.length, Math.random());
    return buffers[previousVariant];
  }

  function playLocal() {
    if (!localVoice) return;
    if (localVoice.isPlaying) localVoice.stop();
    localVoice.setBuffer(pickBuffer());
    localVoice.setVolume(LOCAL_SHOT_VOLUME);
    localVoice.play();
  }

  function playAt(position) {
    if (positionalVoices.length === 0) return;
    const voice = positionalVoices[voiceCursor];
    voiceCursor = (voiceCursor + 1) % positionalVoices.length;
    if (voice.isPlaying) voice.stop();
    voice.position.set(position.x, position.y, position.z);
    voice.setBuffer(pickBuffer());
    voice.setVolume(REMOTE_SHOT_VOLUME);
    voice.play();
  }

  // Call from a real user gesture -- the click-to-play/resume click.
  function unlock() {
    unlocked = true;
    if (listener.context.state !== 'running') listener.context.resume().catch(() => {});
  }

  // Keeps audio in step with the game's run state, so a shot in flight is cut
  // off by a pause instead of playing on over the pause overlay.
  function setRunning(shouldPlay) {
    if (!unlocked) return;
    const action = audioContextAction(listener.context.state, shouldPlay);
    if (action === 'resume') listener.context.resume().catch(() => {});
    if (action === 'suspend') listener.context.suspend().catch(() => {});
  }

  return { playLocal, playAt, unlock, setRunning };
}
