import { describe, expect, it } from 'vitest';
import { formatHealth, formatRespawnCountdown, formatScore, formatAmmo, formatGrenadeCount } from '../../src/ui/hud.js';

describe('formatHealth', () => {
  it('rounds and floors at zero', () => {
    expect(formatHealth(73.6)).toBe('HP 74');
    expect(formatHealth(0)).toBe('HP 0');
    expect(formatHealth(-5)).toBe('HP 0');
  });
});

describe('formatScore', () => {
  it('renders the score value', () => {
    expect(formatScore(3)).toBe('Score 3');
    expect(formatScore(0)).toBe('Score 0');
  });
});

describe('formatRespawnCountdown', () => {
  it('rounds up to the next whole second and floors at zero', () => {
    expect(formatRespawnCountdown(2.1)).toBe('Respawning in 3s');
    expect(formatRespawnCountdown(0.05)).toBe('Respawning in 1s');
    expect(formatRespawnCountdown(-0.5)).toBe('Respawning in 0s');
  });
});

describe('formatAmmo', () => {
  it('hides (empty string) when ammo is null -- the pistol, infinite', () => {
    expect(formatAmmo(null)).toBe('');
  });

  it('renders a readable count for a finite ammo value, including zero', () => {
    expect(formatAmmo(24)).toBe('MG 24');
    expect(formatAmmo(0)).toBe('MG 0');
  });
});

describe('formatGrenadeCount', () => {
  it('hides (empty string) at zero', () => {
    expect(formatGrenadeCount(0)).toBe('');
  });

  it('renders a readable count above zero', () => {
    expect(formatGrenadeCount(2)).toBe('Nades 2');
  });
});
