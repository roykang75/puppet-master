import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parseSnippetFile, mergeSnippets } from '../src/renderer/src/snippets';

describe('parseSnippetFile', () => {
  it('VS Code 포맷: body 배열은 \\n join, placeholder 보존', () => {
    const raw = {
      'Console log': { prefix: 'log', body: ['console.log($1);', '$0'], description: '로그' },
      'If': { prefix: 'if', body: 'if (${1:cond}) { $0 }' },
    };
    const out = parseSnippetFile(raw);
    expect(out).toEqual([
      { label: 'Console log', prefix: 'log', body: 'console.log($1);\n$0', description: '로그' },
      { label: 'If', prefix: 'if', body: 'if (${1:cond}) { $0 }', description: undefined },
    ]);
  });

  it('손상 항목만 무시 (prefix/body 누락, 비정형 입력)', () => {
    const raw = {
      good: { prefix: 'g', body: 'x' },
      noPrefix: { body: 'x' },
      noBody: { prefix: 'n' },
      weird: 42,
    };
    expect(parseSnippetFile(raw).map((s) => s.prefix)).toEqual(['g']);
    expect(parseSnippetFile(null)).toEqual([]);
    expect(parseSnippetFile('str')).toEqual([]);
  });
});

describe('mergeSnippets', () => {
  it('같은 prefix는 사용자 우선, 나머지는 합집합', () => {
    const bundled = [
      { label: 'B-log', prefix: 'log', body: 'B' },
      { label: 'B-if', prefix: 'if', body: 'B' },
    ];
    const user = [{ label: 'U-log', prefix: 'log', body: 'U' }];
    const out = mergeSnippets(bundled, user);
    expect(out.find((s) => s.prefix === 'log')!.label).toBe('U-log');
    expect(out.find((s) => s.prefix === 'if')!.label).toBe('B-if');
    expect(out).toHaveLength(2);
  });
});

describe('번들 기본 세트', () => {
  it('6언어 파일이 파스되고 각 3개 이상', () => {
    for (const lang of ['typescript', 'javascript', 'python', 'java', 'c', 'cpp']) {
      const raw = JSON.parse(fs.readFileSync(`src/renderer/assets/snippets/${lang}.json`, 'utf8'));
      expect(parseSnippetFile(raw).length, lang).toBeGreaterThanOrEqual(3);
    }
  });
});
