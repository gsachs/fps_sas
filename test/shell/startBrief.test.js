// @vitest-environment jsdom
// The start screen tells the player what the match will do: how many
// defenders to clear, and how often the next one is dropped in. Both numbers
// are read from the systems that own them.
//
// Mocked to distinctive values on purpose. Asserting the brief contains "15"
// would pass whether the number was imported or typed by hand, since the real
// constant is 15 -- which is no guard at all against the drift this exists to
// prevent. Feeding the modules numbers the source could not have guessed is
// the only version of this test that can fail.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shell/matchEnd.js', () => ({ KILLS_TO_WIN: 41 }));
vi.mock('../../src/shell/botRamp.js', () => ({ RAMP_INTERVAL_SECONDS: 73 }));

const { createGameShell } = await import('../../src/shell/states.js');

function startScreenText() {
  const container = document.createElement('div');
  const lockElement = document.createElement('div');
  lockElement.requestPointerLock = () => {};
  createGameShell({ container, lockElement, onRestart: () => {}, onPause: () => {} });
  return container.children[0].textContent;
}

describe('start screen brief', () => {
  it('quotes the live kill target', () => {
    expect(startScreenText()).toContain('41');
  });

  it('quotes the live reinforcement interval', () => {
    expect(startScreenText()).toContain('73');
  });

  it('still says what the game is and how to play it', () => {
    const text = startScreenText();
    expect(text).toContain('FOOTHOLD');
    expect(text).toContain('Click to Play');
    expect(text).toContain('WASD');
  });
});
