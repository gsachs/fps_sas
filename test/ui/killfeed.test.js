import { describe, expect, it } from 'vitest';
import { formatEntry, addEntry, ageEntries } from '../../src/ui/killfeed.js';

describe('formatEntry', () => {
  it('Covers AE1: a bot-kills-bot MG event formats as "Bot 2 ≫ Bot 4", neutral class', () => {
    const event = { shooterId: 'bot1', targetId: 'bot3', weapon: 'machinegun', killed: true };

    expect(formatEntry(event)).toEqual({ text: 'Bot 2 ≫ Bot 4', highlightClass: 'neutral' });
  });

  it('produces no entry for a non-lethal hit', () => {
    const event = { shooterId: 'bot0', targetId: 'bot1', weapon: 'machinegun', killed: false };

    expect(formatEntry(event)).toBeNull();
  });

  it('falls back to the default weapon\'s glyph for an unknown weapon id, rather than throwing', () => {
    const mgKill = formatEntry({ shooterId: 'bot0', targetId: 'bot1', weapon: 'machinegun', killed: true });
    const unknownWeaponKill = formatEntry({
      shooterId: 'bot0',
      targetId: 'bot1',
      weapon: 'plasma-cannon',
      killed: true,
    });

    expect(unknownWeaponKill.text).toBe(mgKill.text);
  });
});

describe('addEntry (R2, AE2)', () => {
  it('Covers AE2: two same-tick grenade kills by the player are both gold', () => {
    const firstBlastKill = { shooterId: 'player', targetId: 'bot0', weapon: 'grenade', killed: true };
    const secondBlastKill = { shooterId: 'player', targetId: 'bot1', weapon: 'grenade', killed: true };

    let entries = addEntry([], firstBlastKill);
    entries = addEntry(entries, secondBlastKill);

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.highlightClass === 'gold')).toBe(true);
    expect(entries.every((entry) => entry.text.includes('💥'))).toBe(true);
  });

  it("Covers AE2: the player's own death renders red", () => {
    const entries = addEntry([], { shooterId: 'bot2', targetId: 'player', weapon: 'machinegun', killed: true });

    expect(entries[0].highlightClass).toBe('red');
  });

  it('a self-kill (thrower caught in their own blast) reads as a death, not a kill', () => {
    const entries = addEntry([], { shooterId: 'player', targetId: 'player', weapon: 'grenade', killed: true });

    expect(entries[0].highlightClass).toBe('red');
  });

  it('produces no entry for a non-lethal hit', () => {
    const entries = addEntry([], { shooterId: 'bot0', targetId: 'bot1', weapon: 'machinegun', killed: false });

    expect(entries).toEqual([]);
  });

  it('Covers AE3: caps visible entries at 6, dropping the oldest first', () => {
    let entries = [];
    for (let i = 0; i < 10; i++) {
      entries = addEntry(entries, { shooterId: 'shooter', targetId: `victim${i}`, weapon: 'machinegun', killed: true });
    }

    expect(entries).toHaveLength(6);
    expect(entries[0].text).toContain('victim9'); // most recent kill, newest-first
    expect(entries[5].text).toContain('victim4'); // oldest surviving kill
    expect(entries.some((entry) => entry.text.includes('victim0'))).toBe(false); // earliest kills dropped
    expect(entries.some((entry) => entry.text.includes('victim3'))).toBe(false);
  });
});

describe('ageEntries (R4, AE3)', () => {
  it('dims after the dim threshold and expires after the lifetime', () => {
    let entries = addEntry([], { shooterId: 'bot0', targetId: 'bot1', weapon: 'machinegun', killed: true });

    entries = ageEntries(entries, 1); // still bright, well inside the ~5s lifetime
    expect(entries).toHaveLength(1);
    expect(entries[0].dimmed).toBe(false);

    entries = ageEntries(entries, 2.5); // past the ~2s dim threshold
    expect(entries).toHaveLength(1);
    expect(entries[0].dimmed).toBe(true);

    entries = ageEntries(entries, 5); // well past the ~5s total lifetime
    expect(entries).toHaveLength(0);
  });
});
