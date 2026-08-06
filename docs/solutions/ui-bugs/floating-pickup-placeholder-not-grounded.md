---
title: Grenade and machine-gun pickups rendered as floating placeholder boxes instead of grounded real models
date: 2026-08-06
category: ui-bugs
module: pickup-meshes
problem_type: ui_bug
component: service_object
symptoms:
  - "Picking up the grenade or the machine gun showed a plain colored box hovering above the floor instead of a real, grounded model -- reported by the player as \"where I pick the grenade and machine gun, its a box floating in air\" -- even though the prior visual-fidelity pass (docs/plans/2026-08-06-004-feat-visual-fidelity-plan.md) had already replaced bots and held weapons with real models."
  - "Bots and the pistol/machine-gun viewmodels already had a working non-blocking async placeholder-to-real-model swap-in path (src/render/models.js's loadPropModel/loadCharacterModel, wired up in src/main.js), but src/render/pickupMeshes.js's createPickupMeshes never invoked it for either pickup type -- the placeholder box was the only visual state a pickup could ever reach."
  - "The placeholder's PICKUP_Y_OFFSET (0.5) was tuned to make the box read as a floating collectible marker above pickup.y (the simulation's ground-level collection-detection anchor) -- correct for a stylized placeholder, but exactly what produced the 'floating in air' look once the player expected a grounded, real-looking object."
root_cause: incomplete_setup
resolution_type: code_fix
severity: medium
tags: [pickups, grounding, bounding-box, async-model-swap, placeholder-mesh, grenade, machine-gun, cc0-model]
related_components: [models, model-assets, weapon-view, bot-model]
---

# Grenade and machine-gun pickups rendered as floating placeholder boxes instead of grounded real models

## Problem

The two floor pickups (machine-gun and grenade) rendered as a plain colored box hovering above the floor instead of a real, grounded prop, even after the rest of the visual-fidelity pass (real textures, post-processing, decals, real weapon/bot models, skybox) had shipped in `docs/plans/2026-08-06-004-feat-visual-fidelity-plan.md`. Fixed in commit `cb4fcf4` ("fix(render): ground pickups in real models, not floating placeholder boxes"), confirmed reachable on `main` via `git merge-base --is-ancestor cb4fcf4 HEAD`.

## Symptoms

- Player-visible: picking up items worked, but visually "it's a box floating in air" for both the grenade and machine-gun pickups — the one remaining rough edge the player called out once everything else (real weapon viewmodels, real bot rig, real arena textures, skybox) had already been swapped in.
- The float was deliberate at the code level, not a bug in the old sense: `src/render/pickupMeshes.js:11-16` still defines `PICKUP_HALF_SIZE` and a `PICKUP_Y_OFFSET` of `0.5` that "lifts the box above the pickup's ground-level descriptor position so it reads as a floating collectible, not a box sunk into the floor" — a reasonable placeholder convention that simply had no real-model swap-in behind it yet, unlike every other placeholder in the game (bots, first-person pistol, first-person machine-gun) which had already been replaced earlier in the same plan.

## What Didn't Work

No failed intermediate attempts occurred on this fix. It was implemented by following an already-established pattern in the codebase (the async placeholder-swap-in used for bots and weapon viewmodels) rather than inventing a new mechanism, so there was no wrong turn to document here. The only genuine judgment calls were (1) which CC0 asset to source for the grenade, resolved in `CREDITS.md:21-24` by choosing Quaternius's sci-fi-styled "Scifi Grenade" over its plainer CC0 "Grenade," for the same stylistic-consistency reason the machine-gun's own Rifle asset was chosen over other candidates (`CREDITS.md:14-20`); and (2) whether to source a second rifle model for the ground pickup or reuse the existing viewmodel asset with a different transform — the commit reuses the shipped `public/assets/weapons/quaternius-rifle-static.glb` unchanged (`src/render/modelAssets.js:150`, `CREDITS.md:18-20`), avoiding a second asset download for a model that was already correctly shaped, just authored in the wrong orientation and scale for a floor prop.

Before shipping, the fix was independently re-verified rather than trusted on the workflow's self-report: the full test suite (440/440) and production build were re-run directly, the shipped `public/assets/props/grenade.glb` was confirmed a valid GLB via `file`, and all three of `MACHINEGUN_PICKUP_MODEL`'s offset values (`x: 0.062, y: 0.034, z: 0.235`, `src/render/modelAssets.js:167`) were independently re-derived by hand from the native bounding-box numbers documented in that file's own comments (`src/render/modelAssets.js:139-143`) and confirmed to match the shipped constants exactly.

## Solution

**1. The placeholder gained a real-model descriptor and an async swap-in path.** Previously `createPickupMeshes` only ever built the box. The current `src/render/pickupMeshes.js` extracts that into `createPlaceholderMesh` (`src/render/pickupMeshes.js:42-57`) and adds a lookup from pickup type to real-asset descriptor:

```js
// Which real-asset descriptor (modelAssets.js) replaces a given pickup
// type's placeholder box, once loaded.
const PICKUP_MODEL_BY_TYPE = {
  [MACHINEGUN_WEAPON_ID]: MACHINEGUN_PICKUP_MODEL,
  grenade: GRENADE_MODEL,
};
```
(`src/render/pickupMeshes.js:27-32`)

The swap-in itself is the async function `loadRealPickupModel` (`src/render/pickupMeshes.js:59-88`):

```js
function loadRealPickupModel(scene, meshById, pickup, model) {
  loadPropModel(assetUrl(model.path), {
    onError: (error) => console.warn(`Failed to load ${pickup.type} pickup model:`, error),
  }).then((result) => {
    if (!result.loaded) return;
    const { scene: modelScene } = result;
    const rotation = model.rotation ?? { x: 0, y: 0, z: 0 };
    modelScene.name = `pickup-${pickup.type}`;
    modelScene.scale.setScalar(model.scale);
    modelScene.rotation.set(rotation.x, rotation.y, rotation.z);
    modelScene.position.set(pickup.x + model.offset.x, model.offset.y, pickup.z + model.offset.z);
    modelScene.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });

    const placeholder = meshById.get(pickup.id);
    modelScene.visible = placeholder.visible;
    scene.remove(placeholder);
    disposeObject3D(placeholder);
    meshById.set(pickup.id, modelScene);
    scene.add(modelScene);
  });
}
```

Called from `createPickupMeshes`'s per-pickup loop right after the placeholder is added, keyed by whether `PICKUP_MODEL_BY_TYPE` has an entry for that pickup's type (`src/render/pickupMeshes.js:90-100`):

```js
for (const pickup of pickups) {
  const mesh = createPlaceholderMesh(pickup);
  scene.add(mesh);
  meshById.set(pickup.id, mesh);

  const model = PICKUP_MODEL_BY_TYPE[pickup.type];
  if (model) loadRealPickupModel(scene, meshById, pickup, model);
}
```

Note the y-position line: `pickup.y` is deliberately **not** used for the swapped-in model's vertical placement — `modelScene.position.set(pickup.x + model.offset.x, model.offset.y, pickup.z + model.offset.z)` uses `model.offset.y` alone (`src/render/pickupMeshes.js:76`), because `pickup.y` is `src/sim/pickups.js`'s collection-detection anchor, not a render height; the placeholder used it only as a base to add its own float offset to (`(pickup.y ?? 0) + PICKUP_Y_OFFSET`, `src/render/pickupMeshes.js:54`), and the real model replaces that with an absolute, bounding-box-derived floor height instead.

**2. The bounding-box-offset math, per descriptor, in `src/render/modelAssets.js`.** Both new descriptors follow the same recipe: the header comment (`src/render/modelAssets.js:107-120`) establishes the measurement method — load the model, `new THREE.Box3().setFromObject(scene)`, read `size`/`center`/`min` — and `GRENADE_MODEL`'s own comment (`src/render/modelAssets.js:132-135`) spells out the resulting formula: `offset.x/z = -center.x/z * scale` (recenter over the pickup point) and `offset.y = -min.y * scale` (lift the lowest vertex to the floor).

For the grenade, the measured native bbox is documented inline, and the render height is derived (not eyeballed) from the file's existing `HUMANOID_RENDER_HEIGHT` constant (`src/render/modelAssets.js:118-137`):

```js
// Grenade native bbox: size (0.1785, 0.3033, 0.1447), centre
// (-0.0036, -0.0039, ~0), min.y -0.1556 -- authored standing upright on its
// long (Y) axis, origin near centre, not base.
const GRENADE_NATIVE_HEIGHT = 0.3033;
// A real fragmentation grenade (e.g. M67) stands roughly 9-14cm tall
// including the safety lever -- about a ninth of a person's height.
const GRENADE_RENDER_HEIGHT = HUMANOID_RENDER_HEIGHT / 9; // ~0.178m

export const GRENADE_MODEL = {
  path: 'assets/props/grenade.glb',
  scale: GRENADE_RENDER_HEIGHT / GRENADE_NATIVE_HEIGHT,
  offset: { x: 0.002, y: 0.091, z: 0 },
};
```

**3. The rifle's 90-degree roll.** `MACHINEGUN_PICKUP_MODEL` reuses the exact same shipped file as the first-person `MACHINEGUN_MODEL` viewmodel (`public/assets/weapons/quaternius-rifle-static.glb`) but gives it its own scale, rotation, and offset for the world-space floor context (`src/render/modelAssets.js:149-168`):

```js
export const MACHINEGUN_PICKUP_MODEL = {
  path: 'assets/weapons/quaternius-rifle-static.glb', // same shipped file as MACHINEGUN_MODEL (see CREDITS.md) -- not re-downloaded, just a different ground-prop transform
  scale: MACHINEGUN_PICKUP_LENGTH / MACHINEGUN_NATIVE_LENGTH,
  // Rolled 90 degrees around its own barrel (Z) axis: authored standing in
  // its held orientation (scope-and-grip axis up), which would read as
  // balanced on end rather than dropped on a floor. Rolling onto its
  // narrowest native axis (X, its width) is what makes that axis the
  // on-ground "height" instead -- the way a rifle actually rests once it
  // falls on its side.
  rotation: { x: 0, y: 0, z: Math.PI / 2 },
  offset: { x: 0.062, y: 0.034, z: 0.235 },
};
```

The rotation matters because the rifle's native bbox (documented at `src/render/modelAssets.js:139-143`: size `(0.6303, 2.4689, 8.8541)`, authored Y-up in its held orientation, scope-to-grip along Y) has its *smallest* extent on X (width, `0.6303`), not Y. Left un-rotated, the model's tall Y axis would stand it on end like a flagpole; rolling 90 degrees around Z swaps X and Y so the model's narrow width axis becomes the vertical "how it rests" axis instead — matching how a dropped rifle actually lies on its side. The offset comment notes the consequence for the grounding math: "Native bbox rolled by the rotation above swaps the x/y extents (rolled min.y equals the pre-roll native min.x)" (`src/render/modelAssets.js:163-167`), so the offset was computed against the *rolled* bbox, not the native one.

The grenade, by contrast, needs no rotation (`rotation.z` stays `0`, unlike the rifle's — `test/render/modelAssets.test.js:177-180` specifically asserts `MACHINEGUN_PICKUP_MODEL.rotation.z` is non-zero) because it was already authored upright on its long axis, which is exactly how a grenade sitting on the floor should read.

## Why This Works

The root cause was structural, not a math error: **no grounding logic existed for pickups at all** before this commit. `src/render/pickupMeshes.js` had no equivalent of `loadCharacterModel`/`loadPropModel` calls — it built one `THREE.BoxGeometry` per pickup and never touched it again except to toggle `visible` in `update()`. Contrast that with bots and weapon viewmodels, which already had the *asynchronous swap-in pattern* — placeholder shown immediately, real model loaded in the background, swap performed once loaded, placeholder left in place forever on failure — wired up in `src/main.js`: `loadCharacterModel(...).then(...)` for bots and `loadWeaponModel`'s `loadPropModel(...).then(...)` for the pistol/machine-gun viewmodels. This fix's `loadRealPickupModel` (`src/render/pickupMeshes.js:59-88`) is structurally the same shape as those two, just moved into `pickupMeshes.js` itself since, per that module's own comment, "its call site (main.js) must not change shape to launch them" (`src/render/pickupMeshes.js:34-40`).

What pickups additionally needed, that neither prior precedent provided directly, was *world-space floor grounding* rather than either of the two existing offset techniques:

- Bots use a fixed-constant vertical correction to align a feet-based rig origin with the physics capsule's center-based origin — a one-axis, hand-picked correction for a specific known rig convention, not a general bounding-box measurement.
- Weapon viewmodels (`WEAPON_MODEL`, `MACHINEGUN_MODEL`, `src/render/modelAssets.js:81-105`) use `offset = -center * scale`, recentering the model around the *camera-relative* weapon group's pivot so recoil animates correctly — this corrects for off-origin authoring, but has no floor concept at all, since a viewmodel never touches the ground.

Grounding a real-world-scale prop in world space needs both ideas combined: `offset.x/z = -center.x/z * scale` to recenter over the pickup's `(x, z)` (borrowed from the weapon viewmodel technique), **plus** a new `offset.y = -min.y * scale` to lift the model's lowest vertex — not its center, and not `pickup.y` — to floor level. This is the correct general fix for this class of problem because these asset packs (Quaternius, via Poly Pizza) are authored centered near their own geometric middle, never at a "base" the game's world position could use directly (documented explicitly for both new descriptors: `src/render/modelAssets.js:132-135` for the grenade and `:163-167` for the rifle). Any grounded prop from this asset source will exhibit the same near-center authoring, so bbox-bottom-anchoring — not eyeballing, not reusing a viewmodel-style center offset alone — is the reusable primitive, and this fix is the first place in the codebase it's applied for a floor-standing (as opposed to camera-relative or capsule-relative) object.

One attribution note for future readers: the fix's own commit message cites "R18" as the origin of the non-blocking, placeholder-on-failure async-load pattern it reuses. R18 is not defined in the visual-fidelity plan (`docs/plans/2026-08-06-004-feat-visual-fidelity-plan.md`) that this fix is a follow-up to — it originates in the earlier `docs/plans/2026-08-03-002-feat-combat-feel-and-lighting-plan.md:89` ("A failed asset load still falls back to placeholder geometry and never blocks startup"), with matching acceptance criterion AE5 at line 111. That earlier plan is where the bot-model/viewmodel async-load convention this fix extends to pickups was first established.

## Prevention

- **Always measure, never eyeball, the offset.** Every one of `GRENADE_MODEL`, `MACHINEGUN_PICKUP_MODEL`, `MACHINEGUN_MODEL`, and `WEAPON_MODEL` documents its own native bounding box (`size`/`center`/`min`) directly in its comment, measured via `new THREE.Box3().setFromObject(scene)` on the loaded model, and derives `scale`/`offset` from those numbers rather than guessing (`src/render/modelAssets.js:9-11`, `:107-120`, `:139-143`). This fix's own pre-ship verification step — re-deriving `MACHINEGUN_PICKUP_MODEL`'s three offset values by hand from the documented bbox and confirming they matched the shipped constants — is itself a demonstration of why documenting the raw measurement inline (not just the final offset) pays off: it makes the derivation independently checkable later, by a human or a future fix, without re-loading the asset.
- **For a floor-standing prop specifically**, compute `offset.y = -min.y * scale`, not a value derived from the model's center or from `pickup.y`/any other simulation-side anchor — those are collection-detection or gameplay values, not render heights, and mixing them (as the placeholder's `PICKUP_Y_OFFSET` approach implicitly did) is exactly the "box floating in air" symptom this fix corrected.
- **If the source pack authors the model in a non-resting orientation** (e.g., held upright rather than lying down, as the rifle was), rotate first, then re-derive `min`/`center` against the *rotated* bbox before computing the ground offset — the rifle's own offset comment calls this out explicitly ("Native bbox rolled by the rotation above swaps the x/y extents," `src/render/modelAssets.js:163-165`) as the detail most likely to be missed.
- **Use the existing regression-test template**, don't write new test shapes from scratch. `test/render/pickupMeshes.test.js`'s `describe('createPickupMeshes real model swap-in', ...)` block covers exactly the cases a new swap-in needs: the swap actually replacing the placeholder with correct position/scale/rotation once the (mocked) load resolves (`test/render/pickupMeshes.test.js:93-131`), the placeholder's current visibility carrying over so an in-flight load doesn't silently reveal a taken pickup (`test/render/pickupMeshes.test.js:133-158`), the placeholder's geometry/material being disposed rather than leaked when swapped out (`test/render/pickupMeshes.test.js:160-181`), and — the R18 case — the placeholder staying in place with no scene-graph change if the load errors (`test/render/pickupMeshes.test.js:183-205`). `test/render/modelAssets.test.js`'s `GRENADE_MODEL`/`MACHINEGUN_PICKUP_MODEL` `describe` blocks (`test/render/modelAssets.test.js:127-181`) are the matching template for the descriptor itself: assert against the real shipped `.glb` (not a fixture) that it's non-skinned (since `loadPropModel`'s plain `.clone()` cannot survive a skinned mesh), that the scaled size lands in a plausible real-world range for the object, and — for anything needing a non-identity `rotation` — that the rotation is actually non-zero rather than a no-op default.

## Related Issues

No existing `docs/solutions/` entry overlaps with this one — all six prior entries (as of this writing) are under `docs/solutions/logic-errors/`, about bot AI, minimap projection math, movement/camera coordinate handedness, and cross-system combat-state bugs (grenade death-strip, killfeed reset). This is the first `docs/solutions/` entry about rendering, asset/model loading, or bounding-box-based grounding.

The relevant prior art instead lives in two plan documents, not other solutions docs:

- `docs/plans/2026-08-06-004-feat-visual-fidelity-plan.md` — the visual-fidelity plan this fix follows up on; its R3 first introduced `MACHINEGUN_MODEL` and the placeholder-on-failure async swap-in convention for the first-person viewmodel that this fix extends to floor pickups. Its KTD6 documents the general convention: "loading follows the cache-by-URL, never-reject, placeholder-on-failure convention; new asset descriptors join the registry with measured (not guessed) scale."
- `docs/plans/2026-08-03-002-feat-combat-feel-and-lighting-plan.md` — the earlier plan (R18/AE5, lines 89/111) that first established the non-blocking, placeholder-on-failure async-load pattern itself, for bot and weapon models.
