import * as THREE from 'three';

// Drives an AnimationMixer's clip selection from the sim's per-entity
// animation hint (idle/moving/dead -- a purely cosmetic, THREE-free signal
// from U3) plus a one-shot firing reaction triggered by 'fire' events. The
// hint stays in the sim; clip names and blending are a render-layer
// concern, kept out of the THREE.js-free simulation (KTD2).
const HINT_TO_CLIP = {
  idle: 'Rig|Idle_Loop',
  moving: 'Rig|Jog_Fwd_Loop',
  dead: 'Rig|Death01',
};
const FIRE_CLIP = 'Rig|Pistol_Shoot';
const FIRE_REACTION_SECONDS = 0.3;

export function createAnimatedCharacter(scene3D, animations) {
  const mixer = new THREE.AnimationMixer(scene3D);
  const actions = new Map();
  for (const clip of animations) {
    const action = mixer.clipAction(clip);
    if (clip.name === FIRE_CLIP || clip.name.includes('Death')) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions.set(clip.name, action);
  }

  let activeAction = null;
  let baseHint = 'idle';
  let fireReactionRemaining = 0;

  function play(clipName) {
    const next = actions.get(clipName);
    if (!next || next === activeAction) return;
    activeAction?.stop();
    next.reset().play();
    activeAction = next;
  }

  // Base loop -- ignored while a fire reaction is playing, so a shot mid-
  // stride doesn't get cut off by an idle/moving hint change underneath it.
  function setBaseHint(hint) {
    baseHint = hint;
    if (fireReactionRemaining <= 0) play(HINT_TO_CLIP[hint] ?? HINT_TO_CLIP.idle);
  }

  function playFireReaction() {
    fireReactionRemaining = FIRE_REACTION_SECONDS;
    play(FIRE_CLIP);
  }

  // Call once per render frame with the real frame delta (not sim DT) --
  // animation is cosmetic and should look smooth regardless of tick rate.
  // Only called while playing (main.js's isSimRunning() gate), so
  // animations freeze on pause rather than jumping on resume.
  function update(deltaSeconds) {
    mixer.update(deltaSeconds);
    if (fireReactionRemaining > 0) {
      fireReactionRemaining -= deltaSeconds;
      if (fireReactionRemaining <= 0) play(HINT_TO_CLIP[baseHint] ?? HINT_TO_CLIP.idle);
    }
  }

  return {
    setBaseHint,
    playFireReaction,
    update,
    // For tests/debugging: which clip is currently active, if any.
    getActiveClipName: () => activeAction?.getClip().name ?? null,
  };
}
