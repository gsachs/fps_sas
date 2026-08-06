// Translates raw pointer-lock mouse deltas and WASD/jump key state into a
// Command each sim tick. Camera orientation is sim-owned (KTD2); this
// module only accumulates yaw/pitch from raw input and never touches a
// THREE.Camera, so it stays reusable for any render layer.
import { createCommand, createFireLatch } from '../sim/command.js';

const PITCH_LIMIT = Math.PI / 2 - 0.01;

// A key code this sampler treats as a discrete, edge-latched action key
// (never movement) -- checked in onKeyDown so a throw press is queued from
// the same unconditional keydown listener main.js already wires for WASD,
// with no new main.js listener needed for it.
const THROW_KEY_CODE = 'KeyG';

export function createInputSampler({ lookSpeed = 0.0022 } = {}) {
  let yaw = 0;
  let pitch = 0;
  const keys = new Set();
  const fireLatch = createFireLatch();
  const throwLatch = createFireLatch();
  // The held-fire level (KTD2): true for every tick between a fire-button
  // press and its release, read only by weapons whose config marks them
  // held-fire. Distinct from fireLatch, which stays edge-triggered for the
  // pistol regardless of how long the button stays down.
  let fireHeld = false;

  function onMouseMove(event) {
    yaw -= event.movementX * lookSpeed;
    pitch -= event.movementY * lookSpeed;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  function onKeyDown(event) {
    // Edge-latch the throw key here, before adding it to `keys`, so the
    // membership check below doubles as the native-key-repeat guard: a held
    // key re-fires keydown every frame in most browsers, but every repeat
    // after the first finds KeyG already present and queues nothing more --
    // one physical key-down, one queued throw.
    if (event.code === THROW_KEY_CODE && !keys.has(THROW_KEY_CODE)) {
      throwLatch.press();
    }
    keys.add(event.code);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  // One discrete fire-button press (e.g. a mouse going down): queues the
  // pistol's next edge-triggered shot (see createFireLatch) and starts the
  // held-fire level for any weapon that reads it -- the trigger going down
  // is both events at once, so both fire immediately with no extra
  // cooldown-window gap.
  function onFirePressed() {
    fireLatch.press();
    fireHeld = true;
  }

  // The fire button coming back up: ends the held-fire level. Never touches
  // fireLatch -- a pistol click's queued edge shot is unaffected by however
  // quickly the button comes back up.
  function onFireReleased() {
    fireHeld = false;
  }

  // Drops every held key, the fire-held level, and any queued-but-unconsumed
  // edge latches -- for window blur, where the browser delivers no
  // keyup/mouseup to an unfocused window, so a physically-held key or button
  // would otherwise stay latched forever and resume acting the instant focus
  // (and the pointer lock it requires) returns. The edge latches need
  // clearing too (U16): consume() only ever runs inside a running sim tick,
  // so a press queued just before blur would otherwise sit pending through
  // the whole pause and fire on the first tick after resume, with no live
  // input at that moment.
  function clearHeldInput() {
    keys.clear();
    fireHeld = false;
    fireLatch.clear();
    throwLatch.clear();
  }

  function sample() {
    let moveZ = 0;
    let moveX = 0;
    if (keys.has('KeyW')) moveZ += 1;
    if (keys.has('KeyS')) moveZ -= 1;
    if (keys.has('KeyD')) moveX += 1;
    if (keys.has('KeyA')) moveX -= 1;

    // Each axis is set independently above, so a diagonal (both axes held)
    // has length sqrt(2) before this -- movement.js multiplies this
    // straight through by MOVE_SPEED with no renormalization of its own,
    // so an un-clamped diagonal would move ~41% faster than a cardinal
    // direction. Bot commands come from an already-normalized seek()
    // direction (steering.js), so this clamp only ever touches player input.
    const length = Math.hypot(moveX, moveZ);
    if (length > 1) {
      moveX /= length;
      moveZ /= length;
    }

    return createCommand({
      moveX,
      moveZ,
      yaw,
      pitch,
      buttons: {
        fire: fireLatch.consume(),
        fireHeld,
        jump: keys.has('Space'),
        throwGrenade: throwLatch.consume(),
      },
    });
  }

  return {
    onMouseMove,
    onKeyDown,
    onKeyUp,
    onFirePressed,
    onFireReleased,
    clearHeldInput,
    sample,
    getYawPitch: () => ({ yaw, pitch }),
    setYaw: (newYaw) => {
      yaw = newYaw;
    },
  };
}
