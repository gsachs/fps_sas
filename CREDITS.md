# Asset Credits

Every asset here is CC0, so none of them require attribution. They are
credited anyway, and the links are worth keeping: they are where to look
first when an asset needs replacing.

## Models

By [Quaternius](https://poly.pizza/u/Quaternius), via [Poly Pizza](https://poly.pizza).

- **Animated Robot** — [source](https://poly.pizza/m/QCm7qe9uNJ). Bot avatar.
- **Pistol** — [source](https://poly.pizza/m/1vBdqOfUNd). **No longer used.**
  Was the first-person weapon view until the loadout collapsed to a
  machine-gun-only model; the file still ships but nothing references it.
  Static, not skinned — see `src/render/modelAssets.js` for why that matters.
- **Rifle** — [source](https://poly.pizza/m/cCAgiMOQow). First-person machine-gun
  view, replacing the placeholder box (U5). Static, not skinned, same as the
  Pistol above. Chosen over Quaternius's other sci-fi-styled guns on Poly
  Pizza for its grey/black/red palette, which matches the Pistol's rather
  than clashing with it. It was also the ground model for the machine-gun
  floor pickup, which was retired along with the pistol — the machine gun is
  now every entity's starting weapon, so there is nothing to pick up.
- **Scifi Grenade** — [source](https://poly.pizza/m/uooNRUiCa9). Grenade
  pickup on the floor, replacing the placeholder box. Chosen over
  Quaternius's plainer "Grenade" (also CC0) for its sci-fi styling, matching
  why the Rifle above was chosen over its other sci-fi guns.

## Audio

- **Sci-Fi Sounds** — [Kenney](https://kenney.nl/assets/sci-fi-sounds).
  `laserSmall_000/001/002`, shipped as `gunshot-000/001/002.ogg` — **no longer
  used**, the pistol's fire samples, kept on disk but unreferenced since the
  pistol was retired. `laserLarge_000/001/002`, shipped as
  `machinegun-000/001/002.ogg` (U5, machine-gun fire — its own recording, not
  the same buffers pitched up). `explosionCrunch_000`, shipped as
  `explosion-000.ogg` (U5, grenade explosion — a distinct recording, not the
  gunshot buffers pitched down).

## Environment

- **Kloofendal 48d Partly Cloudy (Pure Sky)** by Greg Zaal and Jarod Guest,
  via [Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)
  (CC0 1.0, Poly Haven's site-wide license). Skybox background (U5, R7),
  shipped as `sky.jpg` — the site's "Tonemapped JPG" export of the HDRI,
  downsized from its native 8192x4096 to 2048x1024 (still full equirectangular
  coverage; the game only ever sees this as a distant background, never up
  close). `src/render/scene.js`'s `SKY_COLOR` and `scene.fog`'s colour are
  both resampled from this image's horizon band so the two blend without a
  seam (KTD5) — re-sample by hand if this asset is ever swapped.

## Textures

Via [ambientCG](https://ambientcg.com) (CC0 1.0, ambientCG's site-wide
license).

- **Tiles 136 A** — [source](https://ambientcg.com/a/Tiles136A). Shared
  panel/composite detail map for the arena's walls, floor, and pillars
  (`panel-composite-color.jpg`) — only the colour/albedo map is used, not
  the full PBR set (normal/roughness/displacement), since `arenaMesh.js`'s
  materials only need `map`. Replaces an earlier dark gunmetal plate texture
  (Metal Plates 006): with `metalness: 0` throughout this codebase's
  materials, that texture's true bare-metal albedo (~28% average luminance,
  authored to be lit mostly by specular reflection, which this arena's
  materials don't use) compounded with this scene's dimmer, ambient-only-lit
  surfaces -- e.g. any wall facing away from the sun -- and crushed them to
  near-black. This clean offset-panel pattern (~81% average luminance) reads
  as composite panelling in the arena's artificial style without that
  compounding, confirmed by live-rendering both textures at the same
  in-scene camera position and comparing.
