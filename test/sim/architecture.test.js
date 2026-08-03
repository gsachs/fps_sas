import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SIM_DIR = join(import.meta.dirname, '..', '..', 'src', 'sim');

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
