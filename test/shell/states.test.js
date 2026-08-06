// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { STATES, transition, formatResultsEntry, createGameShell } from '../../src/shell/states.js';
import { LOCAL_PLAYER_ID } from '../../src/ui/names.js';

describe('transition (pure game-state machine)', () => {
  it('moves from START to PLAYING only on lockAcquired', () => {
    expect(transition(STATES.START, 'lockAcquired')).toBe(STATES.PLAYING);
    expect(transition(STATES.START, 'lockLost')).toBe(STATES.START);
    expect(transition(STATES.START, 'matchEnded')).toBe(STATES.START);
  });

  it('moves from PLAYING to PAUSED on lockLost and to RESULTS on matchEnded', () => {
    expect(transition(STATES.PLAYING, 'lockLost')).toBe(STATES.PAUSED);
    expect(transition(STATES.PLAYING, 'matchEnded')).toBe(STATES.RESULTS);
    expect(transition(STATES.PLAYING, 'lockAcquired')).toBe(STATES.PLAYING);
  });

  it('moves from PAUSED to PLAYING on lockAcquired and to START on returnToStart', () => {
    expect(transition(STATES.PAUSED, 'lockAcquired')).toBe(STATES.PLAYING);
    expect(transition(STATES.PAUSED, 'returnToStart')).toBe(STATES.START);
  });

  it('does not transition on restartMatch alone -- the resulting lockAcquired does', () => {
    expect(transition(STATES.PAUSED, 'restartMatch')).toBe(STATES.PAUSED);
  });

  it('moves from RESULTS to PLAYING on lockAcquired and to START on returnToStart', () => {
    expect(transition(STATES.RESULTS, 'lockAcquired')).toBe(STATES.PLAYING);
    expect(transition(STATES.RESULTS, 'returnToStart')).toBe(STATES.START);
  });
});

describe('formatResultsEntry (R6, AE4)', () => {
  it('renders "You" and "Bot N"-style names for a mixed standings list, no raw ids', () => {
    const leaderboard = [
      { id: 'player', score: 5 },
      { id: 'bot0', score: 3 },
      { id: 'bot2', score: 1 },
    ];

    expect(leaderboard.map(formatResultsEntry)).toEqual(['You — 5', 'Bot 1 — 3', 'Bot 3 — 1']);
  });
});

describe('createGameShell (orchestrator wiring)', () => {
  // Buttons in DOM order, matching createGameShell's own append order:
  // pauseScreen gets [resume, restart, returnToStart] then resultsScreen
  // gets [playAgain, returnToStart]. No test hook exists for these beyond
  // the container the caller already owns.
  function buildShell(onRestart = () => {}) {
    const container = document.createElement('div');
    const lockElement = document.createElement('div');
    // jsdom has no Pointer Lock implementation; the shell only needs the
    // call not to throw; the pointer-lock controller itself is unit-tested
    // separately.
    lockElement.requestPointerLock = () => {};
    const shell = createGameShell({ container, lockElement, onRestart });
    const [resumeButton, restartButton, returnButtonFromPause, playAgainButton, returnButtonFromResults] =
      container.querySelectorAll('button');
    return {
      shell,
      resumeButton,
      restartButton,
      returnButtonFromPause,
      playAgainButton,
      returnButtonFromResults,
      resultsScreen: container.children[2],
    };
  }

  it('calls onRestart before dispatching on all four restart/return-to-start buttons', () => {
    const onRestart = vi.fn();
    const { restartButton, returnButtonFromPause, playAgainButton, returnButtonFromResults } =
      buildShell(onRestart);

    restartButton.click();
    expect(onRestart).toHaveBeenCalledTimes(1);

    returnButtonFromPause.click();
    expect(onRestart).toHaveBeenCalledTimes(2);

    playAgainButton.click();
    expect(onRestart).toHaveBeenCalledTimes(3);

    returnButtonFromResults.click();
    expect(onRestart).toHaveBeenCalledTimes(4);
  });

  it('shows "You Win!" when the local player leads the results leaderboard', () => {
    const { shell, resultsScreen } = buildShell();
    shell.debugForceLockAcquired();

    shell.showResults([
      { id: LOCAL_PLAYER_ID, score: 5 },
      { id: 'bot0', score: 3 },
    ]);

    expect(resultsScreen.querySelector('h2').textContent).toBe('You Win!');
  });

  it('shows "You Lose" when the local player trails the results leaderboard', () => {
    const { shell, resultsScreen } = buildShell();
    shell.debugForceLockAcquired();

    shell.showResults([
      { id: 'bot0', score: 5 },
      { id: LOCAL_PLAYER_ID, score: 3 },
    ]);

    expect(resultsScreen.querySelector('h2').textContent).toBe('You Lose');
  });

  it('adds a fallback entry for the local player when the leaderboard omits them', () => {
    const { shell, resultsScreen } = buildShell();
    shell.debugForceLockAcquired();

    shell.showResults([
      { id: 'bot0', score: 5 },
      { id: 'bot1', score: 3 },
    ]);

    const entries = [...resultsScreen.querySelectorAll('li')].map((li) => li.textContent);
    expect(entries).toContain(formatResultsEntry({ id: LOCAL_PLAYER_ID, score: 0 }));
  });
});
