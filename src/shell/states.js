import { createPointerLockController } from './pointerLock.js';
import { displayName } from '../ui/names.js';
import { LOCAL_PLAYER_ID } from '../sim/entityIds.js';
import {
  DEFAULT_SHADOW_QUALITY,
  otherShadowQuality,
  shadowQualityLabel,
} from './graphicsSettings.js';
import { KILLS_TO_WIN } from './matchEnd.js';
import { RAMP_INTERVAL_SECONDS } from './botRamp.js';

// Pure state machine -- no DOM, no pointer lock -- so transitions are
// unit-testable in isolation. The orchestrator below (createGameShell)
// wraps this with the actual screens and pointer-lock wiring.
export const STATES = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', RESULTS: 'results' };

export function transition(state, event) {
  switch (state) {
    case STATES.START:
      return event === 'lockAcquired' ? STATES.PLAYING : state;
    case STATES.PLAYING:
      if (event === 'lockLost') return STATES.PAUSED;
      if (event === 'matchEnded') return STATES.RESULTS;
      return state;
    case STATES.PAUSED:
      if (event === 'lockAcquired') return STATES.PLAYING;
      if (event === 'returnToStart') return STATES.START;
      return state; // 'restartMatch' re-requests lock; lockAcquired (or a
      // failed retry that leaves state PAUSED) is what actually transitions.
    case STATES.RESULTS:
      if (event === 'lockAcquired') return STATES.PLAYING;
      if (event === 'returnToStart') return STATES.START;
      return state;
    default:
      return state;
  }
}

// R6, AE4: pure per-entry label, extracted so the results list's naming is
// unit-testable without a DOM (mirrors src/ui/hud.js's exported formatters).
export function formatResultsEntry(entry) {
  return `${displayName(entry.id)} — ${entry.score}`;
}

// Dropped in by the player, not shipped: absent, the start screen falls back
// to the live orbiting view of the arena (see the loader below).
const KEY_ART_PATH = `${import.meta.env.BASE_URL}assets/ui/keyart.jpg`;

const CONTROLS_TEXT = 'WASD move · Mouse look · Click fire · Space jump';

function createScreen(container, { visible = false } = {}) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:12px;color:#fff;font-family:system-ui,sans-serif;text-align:center;background:rgba(0,0,0,0.55);';
  el.style.display = visible ? 'flex' : 'none';
  container.appendChild(el);
  return el;
}

function styledButton(label) {
  const button = document.createElement('button');
  button.textContent = label;
  button.style.cssText =
    'font-size:1.1rem;padding:8px 20px;cursor:pointer;background:#2b2f3a;color:#fff;' +
    'border:1px solid #555;border-radius:4px;';
  return button;
}

export function createGameShell({
  container,
  lockElement,
  onRestart,
  onPause,
  shadowQuality = DEFAULT_SHADOW_QUALITY,
  onShadowQualityChange,
}) {
  let state = STATES.START;

  const startScreen = createScreen(container, { visible: true });
  // A gradient rather than the flat wash the other screens use: the arena is
  // orbiting behind this one (render/attractCamera.js) and a key-art image
  // may be layered over it, so the scrim has to darken enough for text to
  // read at the middle without flattening the picture at the edges.
  startScreen.style.background =
    'linear-gradient(to bottom, rgba(6,8,12,0.55) 0%, rgba(6,8,12,0.86) 42%, rgba(6,8,12,0.86) 62%, rgba(6,8,12,0.55) 100%)';
  startScreen.style.gap = '0';

  // Optional key art, behind the text and in front of the live view. Loaded
  // the way every other asset here is (R18): absent or failed, the element
  // simply stays transparent and the orbiting arena shows through, so the
  // screen is complete either way and nothing has to ship to make it work.
  const keyArt = document.createElement('div');
  keyArt.style.cssText =
    'position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;' +
    'transition:opacity 600ms ease;pointer-events:none;';
  startScreen.appendChild(keyArt);
  const keyArtImage = new Image();
  keyArtImage.onload = () => {
    keyArt.style.backgroundImage = `url(${KEY_ART_PATH})`;
    keyArt.style.opacity = '1';
  };
  keyArtImage.src = KEY_ART_PATH;

  // The brief quotes the real numbers by importing them, so a retune of the
  // kill target or the reinforcement interval cannot leave the story telling
  // the player something the match no longer does.
  const brief = document.createElement('div');
  brief.style.cssText = 'position:relative;max-width:44rem;padding:0 2rem;';
  brief.innerHTML =
    `<h1 style="margin:0;font-size:4rem;letter-spacing:0.22em;font-weight:700;">FOOTHOLD</h1>` +
    `<p style="margin:0.35rem 0 1.6rem;font-size:1rem;letter-spacing:0.32em;opacity:0.65;` +
    `text-transform:uppercase;">Secure the site for the landing behind you</p>` +
    `<p style="margin:0 0 0.9rem;font-size:1.05rem;line-height:1.65;opacity:0.9;">` +
    `They put you down alone, ahead of everyone else. The compound has to be clear before ` +
    `the main landing can come down on it &mdash; and the machines holding it know that too.</p>` +
    `<p style="margin:0 0 1.8rem;font-size:1.05rem;line-height:1.65;opacity:0.9;">` +
    `Their drones are already inbound: one more defender every ${RAMP_INTERVAL_SECONDS} seconds, ` +
    `dropped into whichever district you are not standing in.</p>` +
    `<p style="margin:0 0 1.9rem;font-size:1.1rem;letter-spacing:0.12em;">` +
    `<span style="opacity:0.55;text-transform:uppercase;font-size:0.85rem;` +
    `letter-spacing:0.28em;">Objective &nbsp;</span>` +
    `Clear ${KILLS_TO_WIN} defenders and the site is yours</p>` +
    `<div style="font-size:1.45rem;cursor:pointer;letter-spacing:0.06em;">Click to Play</div>` +
    `<p style="margin:1.4rem 0 0;opacity:0.55;font-size:0.9rem;">${CONTROLS_TEXT}</p>`;
  startScreen.appendChild(brief);

  const pauseScreen = createScreen(container);
  const resumeButton = styledButton('Resume');
  const restartButton = styledButton('Restart Match');
  const returnButtonFromPause = styledButton('Return to Start');
  pauseScreen.innerHTML = `<h2 style="margin:0;">Paused</h2>`;
  pauseScreen.append(resumeButton, restartButton, returnButtonFromPause);
  const pauseControlsHint = document.createElement('p');
  pauseControlsHint.style.opacity = '0.8';
  pauseControlsHint.textContent = CONTROLS_TEXT;
  pauseScreen.append(pauseControlsHint);

  // Below the controls hint, after the actions the player came here for: the
  // one graphics setting worth exposing (graphicsSettings.js explains why
  // it is a setting at all). It lives on the pause screen rather than the
  // start screen because the reason to reach for it -- the frame rate is
  // struggling -- only shows up once you are playing, and Escape is already
  // the way out of that.
  let currentShadowQuality = shadowQuality;
  const shadowQualityButton = styledButton(shadowQualityLabel(currentShadowQuality));
  pauseScreen.append(shadowQualityButton);
  shadowQualityButton.addEventListener('click', () => {
    currentShadowQuality = otherShadowQuality(currentShadowQuality);
    shadowQualityButton.textContent = shadowQualityLabel(currentShadowQuality);
    onShadowQualityChange?.(currentShadowQuality);
  });

  const resultsScreen = createScreen(container);
  const resultsHeading = document.createElement('h2');
  resultsHeading.style.margin = '0';
  const resultsList = document.createElement('ol');
  resultsList.style.cssText = 'font-size:1.1rem;padding:0;list-style-position:inside;';
  const playAgainButton = styledButton('Play Again');
  const returnButtonFromResults = styledButton('Return to Start');
  resultsScreen.append(resultsHeading, resultsList, playAgainButton, returnButtonFromResults);

  function updateScreens() {
    startScreen.style.display = state === STATES.START ? 'flex' : 'none';
    pauseScreen.style.display = state === STATES.PAUSED ? 'flex' : 'none';
    resultsScreen.style.display = state === STATES.RESULTS ? 'flex' : 'none';
  }

  function dispatch(event) {
    state = transition(state, event);
    updateScreens();
  }

  const pointerLock = createPointerLockController(lockElement, {
    onLock: () => dispatch('lockAcquired'),
    onUnlock: () => {
      // A lock loss while already at START/RESULTS (e.g. right after
      // exitPointerLock() below) is not a pause -- only PLAYING pauses.
      if (state === STATES.PLAYING) {
        dispatch('lockLost');
        // U24: Escape is the common way this game pauses, and it reaches
        // here -- not the window-blur listener U16 fixed. A press queued
        // right before the pause (fireLatch/throwLatch pending count) must
        // be drained now, same as blur does, or it self-discharges with no
        // live input on the first tick after resume.
        onPause?.();
      }
    },
    onError: () => {
      // Rejected (e.g. the post-Esc cooldown); stay put. The button that
      // requested it remains clickable, so the next real gesture retries.
    },
  });

  startScreen.addEventListener('click', () => pointerLock.requestLock());
  resumeButton.addEventListener('click', () => pointerLock.requestLock());
  restartButton.addEventListener('click', () => {
    onRestart();
    pointerLock.requestLock();
  });
  returnButtonFromPause.addEventListener('click', () => {
    onRestart();
    if (pointerLock.isLocked()) document.exitPointerLock();
    dispatch('returnToStart');
  });
  playAgainButton.addEventListener('click', () => {
    onRestart();
    pointerLock.requestLock();
  });
  returnButtonFromResults.addEventListener('click', () => {
    onRestart();
    dispatch('returnToStart');
  });

  function showResults(leaderboard) {
    if (pointerLock.isLocked()) document.exitPointerLock();
    dispatch('matchEnded');

    const playerEntry = leaderboard.find((entry) => entry.id === LOCAL_PLAYER_ID);
    const isPlayerLeading = leaderboard[0]?.id === LOCAL_PLAYER_ID;
    resultsHeading.textContent = isPlayerLeading ? 'You Win!' : 'You Lose';
    resultsList.innerHTML = '';
    for (const entry of leaderboard) {
      const item = document.createElement('li');
      item.textContent = formatResultsEntry(entry);
      resultsList.appendChild(item);
    }
    // Keep the player's own entry discoverable even if the scoreboard
    // omitted it for some reason (defensive; should not happen in practice).
    if (!playerEntry) {
      const item = document.createElement('li');
      item.textContent = formatResultsEntry({ id: LOCAL_PLAYER_ID, score: 0 });
      resultsList.appendChild(item);
    }
  }

  return {
    isSimRunning: () => state === STATES.PLAYING,
    getState: () => state,
    showResults,
    // Test-only escape hatch: simulates a successful lock without a real
    // one. Automated harnesses cannot acquire real Pointer Lock (no
    // trusted-gesture-with-window-focus outside a human clicking a real
    // browser tab), so this is the only way to exercise PLAYING-state
    // behavior (sim ticking, match-end, restart) under automation. The
    // caller decides whether to expose it (main.js only does behind
    // ?debug); calling it in a normal build has no wiring to reach it.
    debugForceLockAcquired: () => dispatch('lockAcquired'),
    // Same rationale as debugForceLockAcquired, for the pause direction:
    // automation never holds a real lock to lose, so there is no other way
    // to exercise the PAUSED-state pause screen under headless automation.
    debugForceLockLost: () => dispatch('lockLost'),
  };
}
