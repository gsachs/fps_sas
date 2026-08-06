import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SIM_DIR = join(import.meta.dirname, '..', '..', 'src', 'sim');
const SRC_DIR = join(import.meta.dirname, '..', '..', 'src');
const WEAPON_ID_SOURCE_FILE = join(SRC_DIR, 'sim', 'weapon.js');
const MAX_HEALTH_SOURCE_FILE = join(SRC_DIR, 'sim', 'health.js');

function listJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...listJsFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith('.js')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

// A static `from`/`require` specifier is not the only way to pull in
// 'three' -- a dynamic import() is ordinary, idiomatic ESM syntax this
// Vite project fully supports, and would otherwise slip past both checks
// below with zero signal (U27).
const THREE_IMPORT_PATTERN = /from\s+['"]three|require\(\s*['"]three|import\(\s*['"]three/;

describe('sim module architecture guard (KTD2)', () => {
  it('imports nothing from three, directly, via require, or via a dynamic import()', () => {
    const offenders = [];
    for (const file of listJsFiles(SIM_DIR)) {
      const source = readFileSync(file, 'utf8');
      if (THREE_IMPORT_PATTERN.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the pattern itself catches a dynamic import(), not just static from/require (U27 regression)', () => {
    expect(THREE_IMPORT_PATTERN.test("const THREE = await import('three');")).toBe(true);
  });

  // U26: sim/ is the domain layer -- render/ and ui/ depend on it, never the
  // other way around. gatherCommands.js's import of LOCAL_PLAYER_ID from
  // ui/names.js was exactly this crossing, and it landed undetected because
  // the guard above only ever checked for 'three'.
  it('imports nothing from src/ui or src/render', () => {
    const offenders = [];
    for (const file of listJsFiles(SIM_DIR)) {
      const source = readFileSync(file, 'utf8');
      if (/from\s+['"].*\/(ui|render)\//.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// Strips comments before pattern-matching, so prose that merely mentions a
// weapon by name (e.g. "flipped it back to 'pistol'") doesn't false-positive
// as a re-typed id -- only an actual code token (a quoted string literal or
// an object-literal key) counts as the duplication this guard exists to
// catch.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// Matches any quoting style used as a literal value ('pistol', "pistol",
// `pistol`) or the bare identifier used as an object-literal key
// (pistol:) -- every shape an offending call site used before U12's fix,
// plus the template-literal form U27 found the original pattern missed.
// Deliberately NOT chasing string concatenation ('pis' + 'tol') or numeric/
// character-code obfuscation -- those require a real parser to catch
// exhaustively, and a guard this cheap earns its keep against an
// accidental reintroduction, not an adversarial one. Accepted blind spot.
const WEAPON_ID_LITERAL_PATTERN = /(['"`])(pistol|machinegun)\1|\b(pistol|machinegun)\s*:/;

describe('weapon id architecture guard (U12)', () => {
  it('never re-types the pistol/machinegun id literals outside weapon.js', () => {
    const offenders = [];
    for (const file of listJsFiles(SRC_DIR)) {
      if (file === WEAPON_ID_SOURCE_FILE) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (WEAPON_ID_LITERAL_PATTERN.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the pattern itself catches a template-literal reintroduction, not just quoted strings (U27 regression)', () => {
    expect(WEAPON_ID_LITERAL_PATTERN.test('const w = `pistol`;')).toBe(true);
    expect(WEAPON_ID_LITERAL_PATTERN.test('const w = `machinegun`;')).toBe(true);
  });
});

// Matches the specific shapes that re-declare full health as a bare
// literal: an entity's initial `health: 100`, a dotted-access assignment
// (`entity.health = 100`), a bracket-notation assignment
// (`entity['health'] = 100`, added by U27 -- ordinary syntax the dotted
// pattern alone missed), or bot AI's tracked `previousHealth = 100`. Not
// every bare 100 in the codebase, which also appears in unrelated
// constants like BLAST_MAX_DAMAGE, HITSCAN_MAX_DISTANCE, and PARK_POSITION's
// y coordinate. Deliberately not chasing a numeric-literal disguise (0x64,
// 1e2) -- same accepted-blind-spot tradeoff as the weapon-id guard above.
const MAX_HEALTH_LITERAL_PATTERN =
  /\bhealth\s*:\s*100\b|\.health\s*=\s*100\b|\[\s*['"]health['"]\s*\]\s*=\s*100\b|\bpreviousHealth\s*=\s*100\b/;

describe('max health architecture guard (U18)', () => {
  it('never re-types the full-health literal outside health.js', () => {
    const offenders = [];
    for (const file of listJsFiles(SRC_DIR)) {
      if (file === MAX_HEALTH_SOURCE_FILE) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (MAX_HEALTH_LITERAL_PATTERN.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the pattern itself catches bracket-notation reintroduction, not just dotted access (U27 regression)', () => {
    expect(MAX_HEALTH_LITERAL_PATTERN.test("entity['health'] = 100;")).toBe(true);
    expect(MAX_HEALTH_LITERAL_PATTERN.test('entity["health"] = 100;')).toBe(true);
  });
});
