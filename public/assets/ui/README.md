# Start-screen key art

Drop a widescreen image here as `keyart.jpg` and the start screen will fade it
in behind the brief. Nothing ships in this folder by default, and nothing has
to: with no file present the screen falls back to a live, slowly orbiting view
of the arena itself (`src/render/attractCamera.js`), which is a complete
backdrop on its own.

- **Filename:** `keyart.jpg` (exactly — the path is a constant in
  `src/shell/states.js`)
- **Aspect:** 16:9, at least 1920x1080
- **Composition:** the brief sits centred over the middle third, behind a dark
  scrim. Keep the focal point off-centre — low, or to one side — or the text
  will land on top of it.

If the file is missing or fails to load, the loader does nothing and the live
view stays. That is the same placeholder-first contract every other asset in
this project uses: a failed load never leaves a blank screen.
