import * as THREE from 'three';

// Drives an AnimationMixer's clip selection from the sim's per-entity
// animation hint (idle/moving/dead -- a purely cosmetic, THREE-free signal
// from U3) plus a one-shot firing reaction triggered by 'fire' events. The
// hint stays in the sim; clip names and blending are a render-layer
// concern, kept out of the THREE.js-free simulation (KTD2).
//
// Clip names are a property of the *model*, not of this module, so the
// caller supplies the hint->clip mapping. They used to be module constants
// naming one rig's clips ('Rig|Idle_Loop' and friends), which silently
// coupled every animated character to a single asset: swapping in a rig
// from a different pack made every lookup miss and left the model frozen
// in its bind pose with nothing failing loudly. Each model now declares its
// own names alongside its other quirks (see render/botModel.js).
const FIRE_REACTION_SECONDS = 0.3;

// `clipNames` maps each animation hint plus 'fire' to a clip name in
// `animations`: { idle, moving, dead, fire }.
export function createAnimatedCharacter(scene3D, animations, clipNames) {
  const mixer = new THREE.AnimationMixer(scene3D);
  const actions = new Map();
  for (const clip of animations) {
    const action = mixer.clipAction(clip);
    if (clip.name === clipNames.fire || clip.name.includes('Death')) {
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
    if (fireReactionRemaining <= 0) play(clipNames[hint] ?? clipNames.idle);
  }

  function playFireReaction() {
    fireReactionRemaining = FIRE_REACTION_SECONDS;
    play(clipNames.fire);
  }

  // Call once per render frame with the real frame delta (not sim DT) --
  // animation is cosmetic and should look smooth regardless of tick rate.
  // Only called while playing (main.js's isSimRunning() gate), so
  // animations freeze on pause rather than jumping on resume.
  function update(deltaSeconds) {
    mixer.update(deltaSeconds);
    if (fireReactionRemaining > 0) {
      fireReactionRemaining -= deltaSeconds;
      if (fireReactionRemaining <= 0) play(clipNames[baseHint] ?? clipNames.idle);
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
