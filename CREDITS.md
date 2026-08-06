# Asset Credits

Every asset here is CC0, so none of them require attribution. They are
credited anyway, and the links are worth keeping: they are where to look
first when an asset needs replacing.

## Models

By [Quaternius](https://poly.pizza/u/Quaternius), via [Poly Pizza](https://poly.pizza).

- **Animated Robot** — [source](https://poly.pizza/m/QCm7qe9uNJ). Bot avatar.
- **Pistol** — [source](https://poly.pizza/m/1vBdqOfUNd). First-person weapon view.
  Static, not skinned — see `src/render/modelAssets.js` for why that matters.

## Audio

- **Sci-Fi Sounds** — [Kenney](https://kenney.nl/assets/sci-fi-sounds).
  `laserSmall_000/001/002`, shipped as `gunshot-000/001/002.ogg`.

## Textures

By Rob Tuytel, via [ambientCG](https://ambientcg.com) (CC0 1.0, ambientCG's
site-wide license).

- **Metal Plates 006** — [source](https://ambientcg.com/a/MetalPlates006).
  Shared panel/composite detail map for the arena's walls, floor, and
  pillars (`panel-metal-color.jpg`) — only the colour/albedo map is used,
  not the full PBR set (normal/roughness/displacement), since
  `arenaMesh.js`'s materials only need `map`. Chosen over ambientCG's more
  common weathered/rusted metal sets for its clean, regular geometric plate
  pattern, which fits the arena's deliberately artificial style rather than
  photoreal industrial grunge.

## Open gaps

Two assets from the armory-loop plan (U5) are not yet sourced: a dedicated
machine-gun model and a dedicated explosion sample. Both currently ship as
placeholders built from what's already in the game rather than new binaries —
per the plan's own stop condition ("if MG asset sourcing fails, ship the
placeholder and record the gap, don't block the loop on art"):

- **Machine gun** — still the placeholder box `weaponView.js` registers for
  `'machinegun'`, not a loaded model. A real Quaternius-style GLB (see the
  Models section above for the pattern) drops in through
  `weaponView.js`'s existing `setModel(model, transform, 'machinegun')` call
  — the same seam the pistol model already loads through in `main.js` — with
  no other wiring changes needed.
- **Explosion sound** — reuses the existing gunshot samples above, pitched
  down (see `EXPLOSION_SOUND` in `src/audio/gunshots.js`), the same
  pitched-placeholder trick the machine gun's own gunshot sound already
  uses. A real Kenney-style explosion sample drops in by adding its path to
  the `urls` array `gunshots.js` already loads from (`GUNSHOT_PATHS` in
  `src/render/modelAssets.js`) and pointing `playExplosion` at it instead of
  a pitched gunshot buffer.
