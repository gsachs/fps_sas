import { describe, expect, it, vi, afterEach } from 'vitest';
import { raceInitWithTimeout, InitTimeoutError } from '../../src/shell/initTimeout.js';

describe('raceInitWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the init value when init settles before the timeout', async () => {
    vi.useFakeTimers();
    const init = vi.fn().mockResolvedValue('ready');

    const resultPromise = raceInitWithTimeout(init, 15_000);
    // Let the already-resolved init promise's microtasks flush without
    // advancing the fake clock -- the timeout timer must never fire.
    await vi.advanceTimersByTimeAsync(0);

    await expect(resultPromise).resolves.toBe('ready');
  });

  it('rejects with the original error when init rejects before the timeout', async () => {
    vi.useFakeTimers();
    const originalError = new Error('wasm fetch failed');
    // A fresh rejection per call (rather than mockRejectedValue's single
    // shared promise instance) avoids a window where the promise exists
    // unhandled before raceInitWithTimeout's .then attaches to it.
    const init = vi.fn(() => Promise.reject(originalError));

    const resultPromise = raceInitWithTimeout(init, 15_000);
    // Mark as handled before the `await` below yields to the microtask
    // queue -- otherwise Node flags it as an unhandled rejection in the gap
    // before `expect(...).rejects` attaches its own handler.
    resultPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    await expect(resultPromise).rejects.toBe(originalError);
  });

  it('rejects with a distinguishable timeout error when init never settles', async () => {
    vi.useFakeTimers();
    const init = vi.fn(() => new Promise(() => {})); // never settles

    const resultPromise = raceInitWithTimeout(init, 15_000);
    // Suppress unhandled-rejection noise until the assertion below attaches
    // its own handler; the rejection is genuinely expected here.
    resultPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(resultPromise).rejects.toBeInstanceOf(InitTimeoutError);
  });
});
