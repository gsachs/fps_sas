# Start-screen key art

`keyart.jpg` is the image behind the start-screen brief. It is optional: with
no file here the screen falls back to a live, slowly orbiting view of the
arena itself (`src/render/attractCamera.js`), which is a complete backdrop on
its own. A missing or failed load does nothing at all — the same
placeholder-first contract every other asset in this project uses.

- **Filename:** `keyart.jpg` exactly — the path is a constant in
  `src/shell/states.js`
- **Aspect:** 16:9-ish; `background-size: cover` crops to fit, so keep
  anything important away from the very top and bottom
- **Size:** 1920px wide is plenty. It sits behind a dark scrim, so quality 70
  is indistinguishable from the original here and less than half the bytes
  (the shipped file: 2405px/1.3MB regenerated to 1920px/580KB with
  `sips -Z 1920 -s formatOptions 70`)
- **Composition:** the brief is centred over the middle band. Keep the focal
  point low or to one side, or the text lands on it

## Regenerating it

The shipped image was generated from this prompt. Keep it in step with the
game if the districts or the fiction change.

> Cinematic wide key art for a sci-fi shooter called Foothold, 16:9,
> 1920x1080. A lone armoured soldier stands with their back to us on the open
> ground of a large walled compound, seen from slightly behind and above. The
> compound is divided into blocky, flat-roofed districts by low concrete walls
> about waist-to-shoulder height, laid out like a maze seen from the air —
> each district washed in a different muted accent colour: amber, burnt
> orange, deep pink, teal-green, pale yellow. The ground is dusty green. Hard
> midday sun from the upper right, long directional shadows, clean geometric
> shapes, low-poly-adjacent stylisation rather than photorealism. High above
> and small in the frame, two or three quadcopter drones are descending toward
> the far districts, each with a humanoid robot figure slung beneath it on a
> line — reinforcements arriving. Big open sky with scattered cumulus, slight
> atmospheric haze on the far walls. Composition: keep the centre third
> visually quiet and darker — title text will be overlaid there. Put the
> soldier low and off to the left; put the drones high and to the right. No
> text, no logos, no UI, no lens flare. Mood: exposed, outnumbered, calm
> before contact. Muted desaturated palette with the district accent colours
> as the only saturation.

The five accent colours in that prompt are the real ones — `ROOM_ACCENTS` in
`src/arena/layout.js`.
