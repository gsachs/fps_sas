// Directional incoming-damage indicator: an attacker-relative arc that
// appears on the edge of the screen pointing toward the attacker, and
// decays after a short hold. DOM-based, screen-space -- not a 3D object.
const DECAY_MS = 800;

// Bearing from the player to a point, relative to the player's own view yaw
// (0 = directly ahead, positive = to the player's right). Pure geometry,
// extracted so it's unit-testable without a DOM.
export function computeAngleFromPlayer(playerPosition, playerYaw, attackerPosition) {
  const dx = attackerPosition.x - playerPosition.x;
  const dz = attackerPosition.z - playerPosition.z;
  const bearingYaw = Math.atan2(dx, dz);

  const twoPi = Math.PI * 2;
  let diff = (bearingYaw - playerYaw) % twoPi;
  diff = ((diff + Math.PI) % twoPi) - Math.PI; // shortest-path, wrapped to [-pi, pi]
  return diff;
}

export function createDamageIndicator(container) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;left:50%;top:50%;width:220px;height:220px;margin:-110px 0 0 -110px;' +
    'pointer-events:none;opacity:0;transition:opacity 150ms ease-out;';
  el.innerHTML =
    '<svg viewBox="0 0 220 220" width="220" height="220">' +
    '<path d="M110 8 L132 52 L88 52 Z" fill="#ff3b3b" /></svg>';
  container.appendChild(el);

  let hideTimeout = null;

  function show(angleFromPlayer) {
    el.style.opacity = '1';
    el.style.transform = `rotate(${angleFromPlayer}rad)`;
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      el.style.opacity = '0';
    }, DECAY_MS);
  }

  return { show };
}
