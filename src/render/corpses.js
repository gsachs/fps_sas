// Bodies stay where they fell. A bot used to vanish on the exact frame it
// died -- main.js hid its mesh the moment `entity.dead` went true, so the
// rig's own death animation, which is already configured to play once and
// hold its final pose (mixer.js), had never been seen. A fight left nothing
// behind, and there was no way to read from the room whether anything had
// happened in it.
//
// The body is a separate object from the bot, not the bot's own mesh kept
// around: the bot respawns three seconds later and needs its mesh back, and
// the body has to outlive that. Each one is a fresh SkeletonUtils clone from
// models.js's GLTF cache, so it shares geometry and textures with every
// other instance rather than re-fetching or duplicating them, and it runs
// its own mixer so it can hold the death pose independently.
//
// Cosmetic only, by construction rather than by flag: a body is added to the
// scene graph and nothing else. Hitscans and bot line-of-sight both resolve
// against Rapier colliders, and a body has none, so bullets and sight pass
// straight through. That also keeps bodies out of spawn-safety checks, which
// would otherwise start rating a spot "hidden" because something died there.
import { loadCharacterModel } from './models.js';
import { createAnimatedCharacter } from './mixer.js';

// Enough that a busy match reads as one, few enough that the skinned-mesh
// clones and their mixers stay a rounding error. Oldest goes first, so the
// evidence you lose is the evidence that matters least.
const MAX_BODIES = 12;

export function createCorpseField(scene, { modelUrl, model, onError }) {
  const bodies = [];

  function retireOldest() {
    const [oldest] = bodies.splice(0, 1);
    scene.remove(oldest.object3D);
    // Geometry, materials and textures are shared with every other clone of
    // this rig (models.js caches the parsed GLTF), so disposing them here
    // would blank every living bot too. Removing from the scene is the whole
    // of the cleanup; what this instance owns is its mixer, which goes with
    // it.
  }

  // Drops a body at `position`, facing `yaw`, playing the rig's death clip
  // once and clamping on its final pose. The clone resolves from the GLTF
  // cache, so in practice this lands the frame after the kill; a body that
  // appears a frame late is invisible next to the kill feedback firing at
  // the same moment, and it is what keeps this off the critical path.
  function spawn({ position, yaw }) {
    loadCharacterModel(modelUrl, { onError }).then((result) => {
      if (!result.loaded) return;
      const { scene: object3D, animations } = result;
      object3D.name = 'corpse';
      object3D.scale.setScalar(model.scale);
      object3D.position.set(position.x, position.y + model.yOffset, position.z);
      object3D.rotation.y = yaw + model.yawOffset;
      object3D.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });

      const animatedCharacter = createAnimatedCharacter(object3D, animations, model.clips);
      animatedCharacter.setBaseHint('dead');

      if (bodies.length >= MAX_BODIES) retireOldest();
      scene.add(object3D);
      bodies.push({ object3D, animatedCharacter });
    });
  }

  // The death clip clamps on its last frame, so this settles into holding a
  // pose rather than animating forever -- but it still has to be driven, or
  // a body added mid-fall would freeze halfway to the floor.
  function update(deltaSeconds) {
    for (const body of bodies) body.animatedCharacter.update(deltaSeconds);
  }

  function resetAll() {
    for (const body of bodies) scene.remove(body.object3D);
    bodies.length = 0;
  }

  return { spawn, update, resetAll, count: () => bodies.length };
}
