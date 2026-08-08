// What the game actually looks like, measured.
//
// Every check here corresponds to a defect that already shipped and was found
// by a human looking at the screen, because nothing in a 500-test unit suite
// can see a pixel. Each one is a comparison between two measurements taken
// from the SAME frame, so it holds on any GPU, on SwiftShader, and at any
// exposure -- and there is not a stored image anywhere in this directory.
//
// Adding a check here: it must (a) map to a defect that really happened or
// really could, and (b) be impossible to catch by computing over source data.
// If a unit test can catch it, write the unit test instead -- z-fighting
// between coloured walls is a visual symptom whose cause is two boxes sharing
// a volume, and it is asserted in test/arena/layout.test.js, not here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromiumAvailable, startRenderHarness } from './support/renderHarness.js';

const browserReady = await chromiumAvailable();

describe.skipIf(!browserReady)('rendered output', () => {
  let render;

  beforeAll(async () => {
    render = await startRenderHarness();
  });

  afterAll(async () => {
    await render?.close();
  });

  it('boots the real game without a page error', () => {
    // Everything below reads pixels out of a running build, so a broken boot
    // would otherwise surface as a baffling measurement rather than a crash.
    expect(render.failures).toEqual([]);
  });

  // Shipped twice: a depth bias whose world-space size grew with the arena,
  // then the normal bias left behind after it. Both lifted every wall's
  // shadow off its own base, leaving a bright line along the foot of every
  // wall in the map.
  it('has no lit seam where a wall meets the floor', async () => {
    await render.look({ from: { x: 7.5, y: 1, z: -4 }, yaw: Math.PI / 2 });

    const junction = await render.floorStartInColumn(300, 300, 610);
    expect(junction, 'no wall/floor junction found in frame').not.toBeNull();

    const profile = (await render.column(300, junction, junction + 30)).map((pixel) => pixel.l);
    const floor = [...profile.slice(14)].sort((a, b) => a - b);
    const floorTypical = floor[Math.floor(floor.length / 2)];
    // How much brightness sits on the junction over and above ordinary floor,
    // summed across the band. Total excess rather than peak: a seam is a band
    // several rows deep, and the two defects that produced one differ in
    // depth as much as in height -- measured healthy 5, 18 with normalBias
    // alone, 256 with both biases, against a peak ratio that only moved from
    // 1.10 to 1.26 for the first of those and would have needed a threshold
    // too tight to trust.
    //
    // The windows are disjoint on purpose. An earlier version drew its floor
    // reference from inside the band, compared the seam against itself, and
    // passed cleanly against the exact bug it was written to catch.
    const excess = profile.slice(0, 8).reduce((total, l) => total + Math.max(0, l - floorTypical), 0);

    expect(excess).toBeLessThan(12);
  });

  // Shipped three times with three unrelated causes -- an extent hardcoded to
  // a retired arena, a sun standing too close for its own near plane, and a
  // bias that grew -- all looking identical: geometry that stops grounding
  // itself. Deliberately measured in the Bazaar, the far corner of the map:
  // that is where the near-plane bug actually bit, and it is also the first
  // district a too-small shadow box drops. A check at the arena's centre
  // would have passed through all three.
  it('casts shadows from geometry onto the floor around it', async () => {
    // Facing a Bazaar stall from its sun-shadow side, so the shadow it throws
    // lies between the stall and the camera.
    await render.look({ from: { x: 37, y: 1, z: 40 }, yaw: Math.atan2(7, 7) });

    const row = 412; // floor, a little in front of the stall's base
    const shadowed = await render.patch(430, row, 70, 10);
    const lit = await render.patch(140, row, 70, 10);

    // Both samples must actually be on the floor. Without this the test could
    // pass on a frame where the camera drifted onto a wall, and a viewport or
    // FOV change would silently stop testing anything instead of failing.
    for (const sample of [shadowed, lit]) {
      expect(sample.g, 'sampled something that is not the arena floor').toBeGreaterThan(sample.r);
      expect(sample.g, 'sampled something that is not the arena floor').toBeGreaterThan(sample.b);
    }

    // Same row, same surface, same distance -- the only difference between
    // them is whether the stall occludes the sun. Measured: ~45 against ~116.
    // When shadows stop reaching this district, the two converge.
    expect(shadowed.mean).toBeLessThan(lit.mean * 0.7);
  });

  // Shipped as "the boxes are too big": bullet marks were opaque squares, and
  // the muzzle flash and impact spark were faceted solids. The shape of the
  // generated textures is unit-tested in shotTextures.test.js; what only a
  // rendered frame can show is whether a mark is actually *drawn* with one.
  it('leaves bullet marks that are soft and round, not filled squares', async () => {
    // Close to the Yard's sunlit amber wall: a bright surface, so a dark
    // mark and a dark corner are both unambiguous against it.
    await render.look({ from: { x: -50, y: 1, z: 0 }, yaw: -Math.PI / 2 });
    const wallBefore = await render.patch(180, 200, 60, 60);

    await render.fireBurst(4);

    const centre = await render.patch(444, 304, 12, 12);
    const wall = await render.patch(180, 200, 60, 60);

    // Something was actually marked.
    expect(wallBefore.mean).toBeGreaterThan(60); // the wall really is lit
    expect(centre.mean).toBeLessThan(wall.mean * 0.5);

    // ...and its corners are not. A textured mark fades to nothing before the
    // quad's edge, so diagonally out from the centre there is only wall; an
    // opaque square fills those corners with mark. This is the assertion that
    // separates "a bullet hole" from "a black box", and it is the one thing
    // in this file that no source-level test can make.
    const corners = await Promise.all([
      render.patch(476, 336, 10, 10),
      render.patch(414, 274, 10, 10),
      render.patch(476, 274, 10, 10),
      render.patch(414, 336, 10, 10),
    ]);
    for (const corner of corners) {
      expect(corner.mean).toBeGreaterThan(wall.mean * 0.8);
    }
  });

  // Shipped once: the viewmodel's depth-clear pass erased world geometry, and
  // the fix for it is what stops a wall from swallowing the gun when the
  // player stands against one.
  //
  // Against the Landmark's west wall, deliberately not the Yard's: the bullet
  // mark test above fires into the Yard wall, and measuring a "clean wall"
  // reference on a surface another test has just shot at makes this pass or
  // fail on execution order. Tests here take their own locations.
  it('draws the weapon in front of a wall the player is pressed against', async () => {
    await render.look({ from: { x: -9.8, y: 1, z: 0 }, yaw: -Math.PI / 2 });

    const gunCorner = await render.patch(560, 470, 200, 120);
    const wallOnly = await render.patch(120, 150, 200, 120);

    // Pressed against a sunlit wall, the frame is almost entirely one bright
    // surface -- except where the gun is. If the weapon pass regressed and
    // the wall occluded it, the two regions would read the same.
    expect(wallOnly.min, 'not actually pressed against a lit wall').toBeGreaterThan(40);
    expect(gunCorner.min).toBeLessThan(wallOnly.min * 0.5);
  });
});
