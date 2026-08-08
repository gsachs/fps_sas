# Asset Credits

Every asset here is CC0, so none of them require attribution. They are
credited anyway, and the links are worth keeping: they are where to look
first when an asset needs replacing.

## Models

By [Quaternius](https://poly.pizza/u/Quaternius), via [Poly Pizza](https://poly.pizza).

- **Animated Robot** — [source](https://poly.pizza/m/QCm7qe9uNJ). Bot avatar.
- **Rifle** — [source](https://poly.pizza/m/cCAgiMOQow). First-person machine-gun
  view, replacing the placeholder box (U5). Static, not skinned — see
  `src/render/modelAssets.js` for why that matters. Chosen over Quaternius's
  other sci-fi-styled guns on Poly Pizza for its grey/black/red palette. It
  was also the ground model for the machine-gun floor pickup, which retired
  along with the pistol: the machine gun is now every entity's weapon from
  spawn, so there is nothing to pick up.
- **Scifi Grenade** — [source](https://poly.pizza/m/uooNRUiCa9). Both the
  grenade pickup on the floor and the thrown projectile in flight, each with
  its own transform off the same file (grounded for the pickup, recentred
  for the projectile) — the same object either way, so it would be wrong for
  it to change size or model between them. Chosen over Quaternius's plainer
  "Grenade" (also CC0) for its sci-fi styling, matching why the Rifle above
  was chosen over its other sci-fi guns.

## Audio

- **Sci-Fi Sounds** — [Kenney](https://kenney.nl/assets/sci-fi-sounds).
  `laserLarge_000/001/002`, shipped as `machinegun-000/001/002.ogg` (U5,
  machine-gun fire — its own recording, not another weapon's buffers pitched
  up). `explosionCrunch_000`, shipped as `explosion-000.ogg` (U5, grenade
  explosion — likewise its own recording, not the gunshot buffers pitched
  down).

  `laserSmall_000/001/002` shipped as `gunshot-000/001/002.ogg` until the
  pistol was retired; both those assets and the Pistol model above were
  removed once nothing referenced them. The links stay in this file's
  history rather than here.

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
