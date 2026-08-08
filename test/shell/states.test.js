// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { STATES, transition, formatResultsEntry, createGameShell } from '../../src/shell/states.js';
import { LOCAL_PLAYER_ID } from '../../src/sim/entityIds.js';
import { SHADOW_QUALITY, shadowQualityLabel } from '../../src/shell/graphicsSettings.js';

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
  // pauseScreen gets [resume, restart, returnToStart, shadowQuality] then
  // resultsScreen gets [playAgain, returnToStart]. No test hook exists for
  // these beyond the container the caller already owns.
  function buildShell(onRestart = () => {}, onPause = () => {}, options = {}) {
    const container = document.createElement('div');
    const lockElement = document.createElement('div');
    // jsdom has no Pointer Lock implementation; the shell only needs the
    // call not to throw; the pointer-lock controller itself is unit-tested
    // separately.
    lockElement.requestPointerLock = () => {};
    const shell = createGameShell({ container, lockElement, onRestart, onPause, ...options });
    const [
      resumeButton,
      restartButton,
      returnButtonFromPause,
      shadowQualityButton,
      playAgainButton,
      returnButtonFromResults,
    ] = container.querySelectorAll('button');
    return {
      shell,
      resumeButton,
      restartButton,
      returnButtonFromPause,
      shadowQualityButton,
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

  // U24: a press queued right before Escape (lockLost while PLAYING) must not
  // survive the pause and self-discharge on the first tick after resume --
  // same race U16 closed for window blur, but this is the path players
  // actually hit (Escape exits pointer lock, which fires 'pointerlockchange'
  // and lands in the shell's onUnlock handler -- not debugForceLockLost,
  // which bypasses onUnlock entirely, so the real event must be dispatched).
  function fireRealPointerUnlock() {
    // jsdom has no Pointer Lock implementation, so document.pointerLockElement
    // is never set to lockElement -- dispatching the change event alone makes
    // the controller's isLocked() check read false, exactly like a genuine
    // Escape-driven unlock.
    document.dispatchEvent(new Event('pointerlockchange'));
  }

  it('calls onPause exactly once when a lock loss pauses an in-progress match', () => {
    const onPause = vi.fn();
    const { shell } = buildShell(() => {}, onPause);

    shell.debugForceLockAcquired(); // START -> PLAYING
    fireRealPointerUnlock(); // real onUnlock path: PLAYING -> PAUSED, the pause

    expect(shell.getState()).toBe(STATES.PAUSED);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('does not call onPause for a lock loss while not PLAYING (e.g. still at START)', () => {
    const onPause = vi.fn();
    const { shell } = buildShell(() => {}, onPause);

    // Still at START -- never acquired the lock, so this lockLost is not a
    // pause (mirrors the code comment: a lock loss right after
    // exitPointerLock() while already at START/RESULTS is not a pause).
    fireRealPointerUnlock();

    expect(shell.getState()).toBe(STATES.START);
    expect(onPause).not.toHaveBeenCalled();
  });

  // The graphics setting is the one pause-screen control that changes state
  // the player keeps, so its wiring gets the same treatment as the restart
  // buttons above: a view must not be the only place this mapping is proven.
  describe('shadow quality toggle', () => {
    it('opens showing the quality it was given, not a hardcoded default', () => {
      const { shadowQualityButton } = buildShell(undefined, undefined, {
        shadowQuality: SHADOW_QUALITY.STANDARD,
      });

      expect(shadowQualityButton.textContent).toBe(shadowQualityLabel(SHADOW_QUALITY.STANDARD));
    });

    it('reports each flip to the caller and shows the new value', () => {
      const onShadowQualityChange = vi.fn();
      const { shadowQualityButton } = buildShell(undefined, undefined, {
        shadowQuality: SHADOW_QUALITY.HIGH,
        onShadowQualityChange,
      });

      shadowQualityButton.click();
      expect(onShadowQualityChange).toHaveBeenLastCalledWith(SHADOW_QUALITY.STANDARD);
      expect(shadowQualityButton.textContent).toBe(shadowQualityLabel(SHADOW_QUALITY.STANDARD));

      shadowQualityButton.click();
      expect(onShadowQualityChange).toHaveBeenLastCalledWith(SHADOW_QUALITY.HIGH);
      expect(shadowQualityButton.textContent).toBe(shadowQualityLabel(SHADOW_QUALITY.HIGH));
    });

    it('still toggles when no caller is listening', () => {
      const { shadowQualityButton } = buildShell();

      expect(() => shadowQualityButton.click()).not.toThrow();
    });
  });
});
