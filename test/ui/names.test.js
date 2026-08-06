import { describe, expect, it } from 'vitest';
import { displayName } from '../../src/ui/names.js';

describe('displayName', () => {
  it('maps the local player id to "You"', () => {
    expect(displayName('player')).toBe('You');
  });

  it('maps bot ids to 1-based "Bot N" names', () => {
    expect(displayName('bot0')).toBe('Bot 1');
    expect(displayName('bot1')).toBe('Bot 2');
    expect(displayName('bot9')).toBe('Bot 10');
  });

  it('passes an unknown id through unchanged', () => {
    expect(displayName('mystery42')).toBe('mystery42');
  });
});
