// Low-level Pointer Lock API wrapper: requests raw, unadjusted mouse deltas
// where supported, falls back gracefully where not, and reports lock state
// via callbacks -- independent of game/menu state (states.js owns that).
export function createPointerLockController(element, { onLock, onUnlock, onError } = {}) {
  function isLocked() {
    return document.pointerLockElement === element;
  }

  function requestLock() {
    const result = element.requestPointerLock({ unadjustedMovement: true });
    // Older/other browsers may not return a promise at all; only the
    // promise-based path can report the unadjustedMovement-specific
    // rejection, so there's nothing further to do without it.
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        if (error && error.name === 'NotSupportedError') {
          // This browser doesn't support unadjustedMovement -- retry
          // without it. A rejection for any other reason (e.g. the
          // post-Esc cooldown) surfaces via the pointerlockerror event
          // below; the caller's retry-on-next-gesture handles that.
          element.requestPointerLock();
        }
      });
    }
  }

  document.addEventListener('pointerlockchange', () => {
    if (isLocked()) onLock?.();
    else onUnlock?.();
  });
  document.addEventListener('pointerlockerror', () => onError?.());

  return { requestLock, isLocked };
}
