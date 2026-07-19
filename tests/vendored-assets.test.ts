import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const G = 'src/renderer/assets/grammars';
const T = 'src/renderer/assets/themes';

describe('벤더링 자산', () => {
  it('문법 7종 존재 + scopeName 일치', () => {
    const expected: Record<string, string> = {
      'c.tmLanguage.json': 'source.c',
      'cpp.tmLanguage.json': 'source.cpp',
      'python.tmLanguage.json': 'source.python',
      'typescript.tmLanguage.json': 'source.ts',
      'javascript.tmLanguage.json': 'source.js',
      'java.tmLanguage.json': 'source.java',
      'groovy.tmLanguage.json': 'source.groovy',
    };
    for (const [file, scope] of Object.entries(expected)) {
      const j = JSON.parse(fs.readFileSync(path.join(G, file), 'utf8'));
      expect(j.scopeName, file).toBe(scope);
      expect(j.patterns?.length, file).toBeGreaterThan(0);
    }
  });

  it('테마 4종 존재 + 병합 완료 형태(name/type/colors/tokenColors, include 없음)', () => {
    for (const file of ['dark-plus.json', 'light-plus.json', 'monokai.json', 'one-dark-pro.json']) {
      const j = JSON.parse(fs.readFileSync(path.join(T, file), 'utf8'));
      expect(j.name, file).toBeTruthy();
      expect(['dark', 'light']).toContain(j.type);
      expect(Object.keys(j.colors).length, file).toBeGreaterThan(5);
      expect(j.tokenColors.length, file).toBeGreaterThan(5);
      expect(j.include, file).toBeUndefined();
    }
  });
});
