// Drives the real game in a real browser and reads its pixels back.
//
// This layer exists because the project could see its simulation in complete
// detail and could not see its output at all -- and that is exactly where the
// defects concentrated. Shadow seams at every wall base, z-fighting between
// coloured walls, bullet marks rendering as hard black squares: eight in one
// session, none visible to a 500-test unit suite, all found by a human
// looking at the screen.
//
// Two rules keep this from becoming the flakiest thing in the repo.
//
// 1. NO GOLDEN IMAGES. Every assertion is a numeric property, and every
//    number is compared against another number measured FROM THE SAME FRAME
//    -- the seam against the floor beside it, shadowed ground against lit
//    ground. Nothing is compared against a stored absolute, so the suite does
//    not care whether it ran on a discrete GPU, on ANGLE, or on SwiftShader,
//    and it cannot rot the way a checked-in screenshot does.
//
// 2. ONLY WHAT NEEDS PIXELS. If a defect can be caught by computing over the
//    layout data, it belongs in a unit test, which is faster and exact. The
//    wall/corridor z-fighting is a good example: it is a visual symptom, but
//    its cause is two boxes sharing a volume, so it is asserted in
//    test/arena/layout.test.js and deliberately NOT here.
//
// One happy accident worth knowing: the samplers read the WebGL canvas
// directly, and this game's HUD, killfeed and minimap are all DOM and SVG
// overlays. So a measurement sees the rendered world and nothing else --
// no HUD text can drift into a patch and no score change can move a number.
//
// Runs outside `npm test` (see vitest.visual.config.js) because it needs a
// browser and a few seconds of boot. `npm run test:visual`.
import { chromium } from 'playwright';
import { createServer } from 'vite';

// `?debug` is not optional: it installs the window.__debug* hooks used to
// place the camera, and it is also what sets preserveDrawingBuffer on the
// renderer, without which the canvas cannot be read back at all.
const DEBUG_QUERY = '?debug';
const VIEWPORT = { width: 900, height: 620 };
const BOOT_TIMEOUT_MS = 60_000;

export async function chromiumAvailable() {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch {
    // Package installed but browsers not downloaded (`npx playwright install
    // chromium`), or no usable sandbox. Callers skip rather than fail: a
    // missing browser is a missing tool, not a broken game.
    return false;
  }
}

export async function startRenderHarness() {
  const server = await createServer({
    // Port 0 lets the OS pick, so this never collides with a dev server the
    // author already has running.
    server: { port: 0, strictPort: false },
    logLevel: 'error',
  });
  await server.listen();
  const [url] = server.resolvedUrls.local;

  // Prefer the real GPU where the backend is known (headless Chromium
  // otherwise falls back to SwiftShader, which renders this scene at about
  // 7fps and turns a 20-second suite into a two-minute one), but always
  // allow the software path so this still runs on a machine or CI box
  // without a GPU. Both are valid here: every assertion compares two
  // measurements from the same frame, so neither backend changes a verdict.
  const gpuArgs = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
  const browser = await chromium.launch({
    args: [...gpuArgs, '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const failures = [];
  page.on('pageerror', (error) => failures.push(String(error).split('\n')[0]));

  await page.goto(`${url}${DEBUG_QUERY}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__debugState === 'function', { timeout: BOOT_TIMEOUT_MS });
  // Wait on the bot rig specifically: it is the slowest asset, so once it is
  // in, the sky texture and weapon model are in too. A fixed sleep here would
  // be the flake this whole layer is trying to avoid.
  await page.waitForFunction(() => window.__debugModelSizes?.().bot0 != null, { timeout: BOOT_TIMEOUT_MS });

  const renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });

  // A controlled scene: playing (pointer lock cannot be acquired headless),
  // every bot parked far below the arena so nothing wanders into frame, and
  // the player held alive so a stray bot cannot end a measurement.
  await page.evaluate(() => {
    window.__debugForcePlaying();
    for (const bot of window.__debugState().bots) {
      window.__debugTeleportEntity(bot.id, { x: 0, y: -100, z: 0 });
    }
    window.__visualKeepAlive = setInterval(() => {
      const player = window.__debugState().player;
      player.health = 100;
      player.dead = false;
    }, 8);
  });

  async function settle(frames = 20) {
    await page.evaluate(
      (count) =>
        new Promise((resolve) => {
          let seen = 0;
          const tick = () => (++seen >= count ? resolve() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      frames
    );
  }

  // Puts the camera somewhere specific and lets the frame settle. Every
  // measurement starts here, so a test never depends on where the last one
  // left the player.
  async function look({ from, yaw }) {
    await page.evaluate(
      ({ from, yaw }) => {
        window.__debugTeleportEntity('player', from);
        window.__debugSetYaw(yaw);
      },
      { from, yaw }
    );
    await settle(25);
  }

  // Luminance and colour down a vertical line of the frame, top to bottom.
  // Luminance because every defect this layer watches for is about how light
  // or dark something is next to its neighbour; the raw channels come too,
  // because telling floor from wall is a question about hue.
  async function column(x, y0, y1) {
    return page.evaluate(
      ({ x, y0, y1 }) => {
        const source = document.querySelector('canvas');
        const buffer = document.createElement('canvas');
        buffer.width = source.width;
        buffer.height = source.height;
        const context = buffer.getContext('2d');
        context.drawImage(source, 0, 0);
        const scale = source.width / source.clientWidth;
        const rows = [];
        for (let y = y0; y <= y1; y += 1) {
          const d = context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
          rows.push({ y, l: 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2], r: d[0], g: d[1], b: d[2] });
        }
        return rows;
      },
      { x, y0, y1 }
    );
  }

  // The screen row where a downward scan first hits floor. The arena's floor
  // is the only strongly green surface in the scene, so hue separates it from
  // every wall, pillar and accent -- which means a test can find the
  // wall/floor junction rather than hardcoding a row that a viewport or FOV
  // change would silently invalidate.
  async function floorStartInColumn(x, y0, y1) {
    const scan = await column(x, y0, y1);
    return scan.find((pixel) => pixel.g - Math.max(pixel.r, pixel.b) > 6)?.y ?? null;
  }

  // Luminance across a horizontal line -- the companion to `column`, for
  // features that are wider than they are tall.
  async function row(y, x0, x1) {
    return page.evaluate(
      ({ y, x0, x1 }) => {
        const source = document.querySelector('canvas');
        const buffer = document.createElement('canvas');
        buffer.width = source.width;
        buffer.height = source.height;
        const context = buffer.getContext('2d');
        context.drawImage(source, 0, 0);
        const scale = source.width / source.clientWidth;
        const cells = [];
        for (let x = x0; x <= x1; x += 1) {
          const d = context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
          cells.push({ x, l: 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2], r: d[0], g: d[1], b: d[2] });
        }
        return cells;
      },
      { y, x0, x1 }
    );
  }

  // Mean luminance over a rectangle -- for comparing one patch of the frame
  // against another patch of the same frame.
  async function patch(x, y, width, height) {
    return page.evaluate(
      ({ x, y, width, height }) => {
        const source = document.querySelector('canvas');
        const buffer = document.createElement('canvas');
        buffer.width = source.width;
        buffer.height = source.height;
        const context = buffer.getContext('2d');
        context.drawImage(source, 0, 0);
        const scale = source.width / source.clientWidth;
        const pixels = context.getImageData(
          Math.round(x * scale),
          Math.round(y * scale),
          Math.round(width * scale),
          Math.round(height * scale)
        ).data;
        let total = 0;
        let count = 0;
        let min = Infinity;
        let max = -Infinity;
        const channel = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4) {
          const l = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
          total += l;
          count += 1;
          min = Math.min(min, l);
          max = Math.max(max, l);
          channel[0] += pixels[i];
          channel[1] += pixels[i + 1];
          channel[2] += pixels[i + 2];
        }
        // Mean colour as well as brightness, so a test can assert it is
        // actually looking at the surface it thinks it is -- a check that
        // turns "the camera moved" from a silent pass into a loud failure.
        return {
          mean: total / count,
          min,
          max,
          count,
          r: channel[0] / count,
          g: channel[1] / count,
          b: channel[2] / count,
        };
      },
      { x, y, width, height }
    );
  }

  // Fires, then lets go. Releasing matters: the gun is held-fire, so a burst
  // that is never released leaves the muzzle flash blowing out the exposure
  // over whatever the test is trying to measure.
  async function fireBurst(shots) {
    await page.evaluate(() => window.__debugFire());
    for (let i = 0; i < shots; i += 1) await settle(2);
    await page.evaluate(() => window.__debugStopFiring());
    await settle(20); // flash and sparks expire
  }

  async function screenshot(path) {
    await page.screenshot({ path });
  }

  async function close() {
    await page.evaluate(() => clearInterval(window.__visualKeepAlive));
    await browser.close();
    await server.close();
  }

  return {
    page,
    renderer,
    viewport: VIEWPORT,
    look,
    settle,
    column,
    row,
    patch,
    floorStartInColumn,
    fireBurst,
    screenshot,
    close,
    failures,
  };
}
