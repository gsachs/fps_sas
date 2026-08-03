import { describe, expect, it } from 'vitest';
import { STATES, transition } from '../../src/shell/states.js';

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
