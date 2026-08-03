import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Desktop-only target, so it's safe to require top-level-await support
  // (needed for `await RAPIER.init()` in main.js) instead of adding the
  // vite-plugin-top-level-await workaround.
  build: {
    target: 'esnext',
  },
});
