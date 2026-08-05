# FPS Arena

A browser-based 3D shooter: hunt AI bots through a rooms-and-corridors map
in deathmatch, built with Three.js and Rapier physics. Bots patrol,
chase, search a last-seen position when they lose sight of you, and
retreat toward a doorway when hurt. Each corner room carries its own accent
color, echoed on a player-only rotating minimap, so you always know where
you are without giving away anything about the bots.

## Run locally

```bash
npm install
npm run dev
```

Open the printed `localhost` URL, click "Click to Play", and go.

- **Move:** WASD
- **Look:** Mouse
- **Fire:** Click
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

- `docs/plans/` — the design plan this project was built from: product
  requirements, key technical decisions, and the implementation unit
  breakdown.
- `docs/solutions/` — documented bugs and their root causes, organized by
  category with searchable frontmatter. Worth checking before touching
  bot AI or simulation code.
- `CONCEPTS.md` — shared vocabulary for this codebase's domain (Command,
  Entity, Bot, Bot Phase).

## Credits

Third-party assets and their licenses are listed in `CREDITS.md`.
