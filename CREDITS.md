# Asset Credits

Every asset here is CC0, so none of them require attribution. They are
credited anyway, and the links are worth keeping: they are where to look
first when an asset needs replacing.

## Models

By [Quaternius](https://poly.pizza/u/Quaternius), via [Poly Pizza](https://poly.pizza).

- **Animated Robot** — [source](https://poly.pizza/m/QCm7qe9uNJ). Bot avatar.
- **Pistol** — [source](https://poly.pizza/m/1vBdqOfUNd). First-person weapon view.
  Static, not skinned — see `src/render/modelAssets.js` for why that matters.
- **Rifle** — [source](https://poly.pizza/m/cCAgiMOQow). First-person machine-gun
  view, replacing the placeholder box (U5). Static, not skinned, same as the
  Pistol above. Chosen over Quaternius's other sci-fi-styled guns on Poly
  Pizza for its grey/black/red palette, which matches the Pistol's rather
  than clashing with it.

## Audio

- **Sci-Fi Sounds** — [Kenney](https://kenney.nl/assets/sci-fi-sounds).
  `laserSmall_000/001/002`, shipped as `gunshot-000/001/002.ogg`.
  `laserLarge_000/001/002`, shipped as `machinegun-000/001/002.ogg` (U5,
  machine-gun fire — a distinct recording from the pistol's, not the same
  buffers pitched up). `explosionCrunch_000`, shipped as `explosion-000.ogg`
  (U5, grenade explosion — a distinct recording, not the gunshot buffers
  pitched down).

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
