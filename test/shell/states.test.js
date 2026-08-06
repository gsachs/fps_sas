import { describe, expect, it } from 'vitest';
import { STATES, transition, formatResultsEntry } from '../../src/shell/states.js';

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
