// The persistent HUD overlay: health, score, and crosshair (with transient
// hit/kill flash states), plus the death/respawn-countdown readout.
// DOM-based, matching the existing click-to-play overlay's approach --
// simpler than 3D text for 2D screen-space UI.
const HITMARKER_DURATION_MS = 150;
const KILL_CONFIRM_DURATION_MS = 500;

// Pure text formatting, extracted so it's unit-testable without a DOM.
export function formatHealth(health) {
  return `HP ${Math.max(0, Math.round(health))}`;
}

export function formatScore(score) {
  return `Score ${score}`;
}

export function formatRespawnCountdown(secondsRemaining) {
  return `Respawning in ${Math.max(0, Math.ceil(secondsRemaining))}s`;
}

export function createHud(container) {
  const root = document.createElement('div');
  root.style.cssText =
    'position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff;';
  container.appendChild(root);

  const healthEl = document.createElement('div');
  healthEl.style.cssText = 'position:absolute;left:16px;bottom:16px;font-size:1.5rem;text-shadow:0 1px 3px #000;';
  root.appendChild(healthEl);

  const scoreEl = document.createElement('div');
  scoreEl.style.cssText = 'position:absolute;right:16px;top:16px;font-size:1.25rem;text-shadow:0 1px 3px #000;';
  root.appendChild(scoreEl);

  // Crosshair as a small state machine: neutral (white) / hit (red flash) /
  // kill (gold flash, held longer) -- never more than one active flash.
  const crosshairEl = document.createElement('div');
  crosshairEl.style.cssText =
    'position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;' +
    'background:#fff;box-shadow:0 0 2px #000;transition:background 60ms,transform 60ms;';
  root.appendChild(crosshairEl);

  const deathEl = document.createElement('div');
  deathEl.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'background:rgba(120,0,0,0.35);font-size:2rem;text-shadow:0 1px 3px #000;';
  root.appendChild(deathEl);

  let flashResetTimeout = null;

  function flashCrosshair(kind) {
    const isKill = kind === 'kill';
    crosshairEl.style.background = isKill ? '#ffd23f' : '#ff3b3b';
    crosshairEl.style.transform = 'scale(1.6)';
    clearTimeout(flashResetTimeout);
    flashResetTimeout = setTimeout(
      () => {
        crosshairEl.style.background = '#fff';
        crosshairEl.style.transform = 'scale(1)';
      },
      isKill ? KILL_CONFIRM_DURATION_MS : HITMARKER_DURATION_MS
    );
  }

  function update({ health, score, dead, respawnSecondsRemaining }) {
    healthEl.textContent = formatHealth(health);
    scoreEl.textContent = formatScore(score);
    deathEl.style.display = dead ? 'flex' : 'none';
    if (dead) {
      deathEl.textContent = formatRespawnCountdown(respawnSecondsRemaining);
    }
  }

  return { update, flashCrosshair };
}
