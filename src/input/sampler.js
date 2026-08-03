// Translates raw pointer-lock mouse deltas and WASD/jump key state into a
// Command each sim tick. Camera orientation is sim-owned (KTD2); this
// module only accumulates yaw/pitch from raw input and never touches a
// THREE.Camera, so it stays reusable for any render layer.
import { createCommand, createFireLatch } from '../sim/command.js';

const PITCH_LIMIT = Math.PI / 2 - 0.01;

export function createInputSampler({ lookSpeed = 0.0022 } = {}) {
  let yaw = 0;
  let pitch = 0;
  const keys = new Set();
  const fireLatch = createFireLatch();

  function onMouseMove(event) {
    yaw -= event.movementX * lookSpeed;
    pitch -= event.movementY * lookSpeed;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  function onKeyDown(event) {
    keys.add(event.code);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  // One discrete fire-button press (e.g. a mouse click), queued for the
  // next sample() -- see createFireLatch for why this is edge-triggered
  // rather than a held-down level.
  function onFirePressed() {
    fireLatch.press();
  }

  function sample() {
    let moveZ = 0;
    let moveX = 0;
    if (keys.has('KeyW')) moveZ += 1;
    if (keys.has('KeyS')) moveZ -= 1;
    if (keys.has('KeyD')) moveX += 1;
    if (keys.has('KeyA')) moveX -= 1;

    return createCommand({
      moveX,
      moveZ,
      yaw,
      pitch,
      buttons: { fire: fireLatch.consume(), jump: keys.has('Space') },
    });
  }

  return {
    onMouseMove,
    onKeyDown,
    onKeyUp,
    onFirePressed,
    sample,
    getYawPitch: () => ({ yaw, pitch }),
    setYaw: (newYaw) => {
      yaw = newYaw;
    },
  };
}
