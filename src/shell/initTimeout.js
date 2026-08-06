// A rejected startup promise already reaches the try/catch in main.js, but a
// hung one (e.g. a blocked WASM fetch that never settles) never rejects at
// all -- so a bare `await` black-screens the player forever. Racing init
// against a timer makes "taking too long" observable as a rejection too.
export class InitTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Initialization timed out after ${timeoutMs}ms`);
    this.name = 'InitTimeoutError';
  }
}

// Default: generous enough for a slow WASM fetch on a bad connection, short
// enough that a genuinely hung load doesn't leave the player staring at a
// black screen indefinitely. Not product-specified -- a defensible default.
export const DEFAULT_INIT_TIMEOUT_MS = 15_000;

export function raceInitWithTimeout(init, timeoutMs = DEFAULT_INIT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new InitTimeoutError(timeoutMs)), timeoutMs);
    init().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
