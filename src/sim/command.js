// The single Command shape every entity (local player, bot, future remote
// peer) emits into the simulation. Continuous fields (movement, look) apply
// every sub-tick. `fire` and `throwGrenade` are edge-triggered (see
// createFireLatch) so their counts stay framerate-independent regardless of
// how many sim ticks a render frame runs; `fireHeld` is the one *level*
// field -- true for every tick the trigger is physically down, read only by
// weapons whose config marks them held-fire (KTD2). The pistol never reads
// it, which is what keeps its click-per-shot feel unchanged.
export function createCommand(overrides = {}) {
  return {
    tick: 0,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false },
    ...overrides,
  };
}

// A queue of discrete fire-button presses. Each press() call (one per input
// event -- a click, or a bot's decision to shoot) queues exactly one shot;
// each consume() call drains at most one, so N presses always yield N
// consumed shots no matter how sim ticks and render frames align.
export function createFireLatch() {
  let pending = 0;
  return {
    press() {
      pending += 1;
    },
    consume() {
      if (pending > 0) {
        pending -= 1;
        return true;
      }
      return false;
    },
  };
}
