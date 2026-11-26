import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(import.meta.dirname);

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe('CSS architecture hygiene', () => {
  it('loads global design-system layers in strict cascade order in main.jsx', () => {
    const mainText = fs.readFileSync(path.join(SRC_DIR, 'main.jsx'), 'utf8');
    const expectedOrder = [
      './theme.css',
      './styles.css',
      './responsive.css',
      './lab-preview.css',
      './primus-tokens.css',
      './primus-living.css',
      './primus-studio.css',
    ];
    let lastIdx = -1;
    for (const sheet of expectedOrder) {
      const idx = mainText.indexOf(sheet);
      expect(idx, `${sheet} must be imported in main.jsx`).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('has zero orphaned CSS files and every CSS import resolves cleanly', () => {
    const allFiles = walkFiles(SRC_DIR);
    const cssFiles = new Set(
      allFiles
        .filter((f) => f.endsWith('.css'))
        .map((f) => path.relative(SRC_DIR, f)),
    );
    const codeFiles = allFiles.filter((f) => /\.(jsx?|tsx?)$/.test(f) && !f.endsWith('.test.js'));
    const referenced = new Set();
    const importRe = /import\s+['"](\.[^'"]+\.css)['"]/g;
    for (const file of codeFiles) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(importRe)) {
        const resolved = path.relative(SRC_DIR, path.resolve(path.dirname(file), match[1]));
        expect(cssFiles.has(resolved), `Missing CSS target ${resolved} imported from ${file}`).toBe(true);
        referenced.add(resolved);
      }
    }
    const orphaned = [...cssFiles].filter((f) => !referenced.has(f));
    expect(orphaned, `Orphaned CSS files found: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('keeps consolidated stylesheet count bounded below legacy 26-file sprawl', () => {
    const cssFiles = walkFiles(SRC_DIR).filter((f) => f.endsWith('.css'));
    expect(cssFiles.length).toBeLessThanOrEqual(19);
  });
});
