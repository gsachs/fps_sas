import { createPointerLockController } from './pointerLock.js';
import { displayName, LOCAL_PLAYER_ID } from '../ui/names.js';

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

export function createGameShell({ container, lockElement, onRestart }) {
  let state = STATES.START;

  const startScreen = createScreen(container, { visible: true });
  startScreen.innerHTML =
    `<h1 style="margin:0;font-size:2.5rem;">FPS Arena</h1>` +
    `<div style="font-size:1.5rem;cursor:pointer;">Click to Play</div>` +
    `<p style="opacity:0.8;">${CONTROLS_TEXT}</p>`;

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
      if (state === STATES.PLAYING) dispatch('lockLost');
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
    if (pointerLock.isLocked()) document.exitPointerLock();
    dispatch('returnToStart');
  });
  playAgainButton.addEventListener('click', () => {
    onRestart();
    pointerLock.requestLock();
  });
  returnButtonFromResults.addEventListener('click', () => dispatch('returnToStart'));

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
