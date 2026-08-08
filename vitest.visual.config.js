import { defineConfig } from 'vitest/config';

// The visual layer runs on its own command, not as part of `npm test`.
// It needs a browser, a Vite server and a few seconds of scene boot, and the
// unit suite's value is that it stays fast and hermetic -- folding a browser
// into it would cost that for every run.
export default defineConfig({
  test: {
    include: ['test/visual/**/*.visual.js'],
    // One browser and one game boot are shared across the file; running files
    // in parallel would put two of them on the same GPU and race for it.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
