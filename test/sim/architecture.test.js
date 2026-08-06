import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SIM_DIR = join(import.meta.dirname, '..', '..', 'src', 'sim');
const SRC_DIR = join(import.meta.dirname, '..', '..', 'src');
const WEAPON_ID_SOURCE_FILE = join(SRC_DIR, 'sim', 'weapon.js');

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

describe('sim module architecture guard (KTD2)', () => {
  it('imports nothing from three, directly or via a bare specifier', () => {
    const offenders = [];
    for (const file of listJsFiles(SIM_DIR)) {
      const source = readFileSync(file, 'utf8');
      if (/from\s+['"]three/.test(source) || /require\(\s*['"]three/.test(source)) {
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

// Matches either quoting style used as a literal value ('pistol', "pistol")
// or the bare identifier used as an object-literal key (pistol:) -- the two
// shapes every offending call site used before U12's fix.
const WEAPON_ID_LITERAL_PATTERN = /(['"])(pistol|machinegun)\1|\b(pistol|machinegun)\s*:/;

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
});
