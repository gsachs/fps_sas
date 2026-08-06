# FPS Arena

A browser-based 3D shooter: hunt AI bots through a textured,
rooms-and-corridors map in deathmatch, built with Three.js and Rapier
physics. Bots patrol, chase, search a last-seen position when they lose
sight of you, and retreat toward a doorway when hurt. Each corner room
carries its own accent color, echoed on a player-only rotating minimap, so
you always know where you are without giving away anything about the
bots. A killfeed under the score narrates every kill as it happens —
yours in gold, your death in red — without ever revealing a position.

The pistol is infinite but weak; a machine gun and grenades spawn as map
pickups (the MG in the central landmark room, grenades in the corners) and
respawn on a timer, so holding those rooms matters. Bullet hits leave
persistent impact decals, and the arena runs through a light
post-processing pass (bloom, ambient occlusion, a skybox) on top of real
sourced models and audio for the weapons.

## Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/01-start-screen.jpg" alt="Start screen, arena visible behind the play prompt"></td>
<td width="50%"><img src="docs/screenshots/02-firefight.jpg" alt="Facing off with a bot in a corridor"></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/03-arena-wide.jpg" alt="A corner room showing its accent color and the skybox"></td>
<td width="50%"><img src="docs/screenshots/04-pickup-closeup.jpg" alt="The machine gun pickup, grounded on the floor of the central room"></td>
</tr>
</table>

## Run locally

```bash
npm install
npm run dev
```

Open the printed `localhost` URL, click "Click to Play", and go.

- **Move:** WASD
- **Look:** Mouse
- **Fire:** Click (hold, for the machine gun — it auto-equips on pickup and auto-reverts to the pistol when dry)
- **Throw grenade:** G (grenades are picked up from corner rooms; area damage hits everyone in blast radius, including the thrower, and is blocked by walls)
- **Jump:** Space

## Build for deployment

```bash
npm run build
```

This produces a static site in `dist/` — no server-side code, no
database. `dist/` is a complete, self-contained website; any static host
works. Asset paths are relative, so the same build works whether it's
served from a domain root or a subdirectory (e.g. a GitHub Pages project
page).

## Deploy

Pick any static host and upload the contents of `dist/`. A few options:

- **Netlify Drop** — go to https://app.netlify.com/drop and drag the
  `dist/` folder in. Gives you a shareable URL immediately, no account
  required for a one-off deploy.
- **Vercel** — `npx vercel --prod dist` (requires a free Vercel account;
  the CLI will prompt you to log in).
- **GitHub Pages** — push this repo to GitHub, then either enable Pages
  from a `dist/` branch/folder, or use `npx gh-pages -d dist` (requires
  the `gh-pages` package: `npm install --save-dev gh-pages`).
- **itch.io** — zip the *contents* of `dist/` (not the folder itself,
  `index.html` must be at the zip root) and upload as an HTML5 project.

## Tests

```bash
npm test
```

## Documentation

- `docs/plans/` — the design plans this project was built from, one per
  feature pass (arena, combat feel, minimap, armory loop, killfeed, visual
  fidelity): product requirements, key technical decisions, and the
  implementation unit breakdown.
- `docs/solutions/` — documented bugs and their root causes, organized by
  category with searchable frontmatter. Worth checking before touching
  bot AI or simulation code.
- `CONCEPTS.md` — shared vocabulary for this codebase's domain (Command,
  Entity, Bot, Bot Phase).

## Credits

Third-party assets and their licenses are listed in `CREDITS.md`.
