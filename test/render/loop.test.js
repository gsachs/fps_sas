// @vitest-environment jsdom -- createRenderLoop's THREE.Timer connects to
// `document` for the Page Visibility API.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRenderLoop } from '../../src/render/loop.js';

const MAX_FRAME_SECONDS = 0.25; // mirrors loop.js's own clamp constant

// A code-review testing gap: createRenderLoop's public contract changed in
// this diff (a direct `renderer.render(scene, camera)` call became an
// injected `render(delta)` callback, so U1's composer could sit behind it)
// but had zero test coverage before now. requestAnimationFrame is faked so
// a tick can be driven deterministically instead of waiting on a real
// browser frame; performance.now() is stubbed so THREE.Timer's delta is
// exactly controlled rather than depending on real wall-clock time.
describe('createRenderLoop', () => {
  let scheduled = null; // { id, cb } | null -- the currently pending rAF, if any
  let nextId = 0;
  let now = 0;

  beforeEach(() => {
    scheduled = null;
    nextId = 0;
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      const id = ++nextId;
      scheduled = { id, cb };
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      if (scheduled?.id === id) scheduled = null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Advances the fake clock and fires the currently-scheduled rAF callback,
  // if one is pending -- a no-op after stop() has cancelled it, the same
  // way a real cancelled rAF never fires.
  function advance(ms) {
    if (!scheduled) return;
    now += ms;
    const { cb } = scheduled;
    scheduled = null;
    cb();
  }

  it('calls onFrame before render on each tick, passing both the same delta', () => {
    const order = [];
    const render = vi.fn((delta) => order.push(['render', delta]));
    const onFrame = vi.fn((delta) => order.push(['onFrame', delta]));

    createRenderLoop({ render, onFrame }).start();
    advance(16);

    expect(order.map(([name]) => name)).toEqual(['onFrame', 'render']);
    expect(order[0][1]).toBeCloseTo(0.016, 5);
    expect(order[1][1]).toBe(order[0][1]);
  });

  it('onFrame is optional -- render still runs without it', () => {
    const render = vi.fn();

    createRenderLoop({ render, onFrame: undefined }).start();
    advance(16);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('clamps delta to MAX_FRAME_SECONDS on a stalled frame (tab refocus)', () => {
    const render = vi.fn();

    createRenderLoop({ render, onFrame: undefined }).start();
    advance(5000); // a multi-second stall, far past the clamp

    expect(render).toHaveBeenCalledWith(MAX_FRAME_SECONDS);
  });

  it('keeps ticking every frame while running', () => {
    const render = vi.fn();

    createRenderLoop({ render, onFrame: undefined }).start();
    advance(16);
    advance(16);
    advance(16);

    expect(render).toHaveBeenCalledTimes(3);
  });

  it('stop() halts further ticks', () => {
    const render = vi.fn();
    const loop = createRenderLoop({ render, onFrame: undefined });

    loop.start();
    advance(16);
    expect(render).toHaveBeenCalledTimes(1);

    loop.stop();
    advance(16); // no pending rAF left to fire -- see advance()'s own no-op guard

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('stop() before any tick is safe (no pending frame to cancel)', () => {
    const render = vi.fn();
    const loop = createRenderLoop({ render, onFrame: undefined });

    expect(() => loop.stop()).not.toThrow();
    expect(render).not.toHaveBeenCalled();
  });
});
