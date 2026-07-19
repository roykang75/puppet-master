import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { tmTokensToMonaco } from '../src/renderer/src/textmate/adapter';

const G = 'src/renderer/assets/grammars';
let registry: Registry;

const SCOPE_FILE: Record<string, string> = {
  'source.c': 'c.tmLanguage.json', 'source.cpp': 'cpp.tmLanguage.json',
  'source.python': 'python.tmLanguage.json', 'source.ts': 'typescript.tmLanguage.json',
  'source.js': 'javascript.tmLanguage.json', 'source.java': 'java.tmLanguage.json',
  'source.groovy': 'groovy.tmLanguage.json',
};

beforeAll(async () => {
  const wasmDir = path.dirname(require.resolve('vscode-oniguruma'));
  const wasm = fs.readFileSync(path.join(wasmDir, 'onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (p) => new OnigScanner(p),
      createOnigString: (s) => new OnigString(s),
    }),
    loadGrammar: async (scope) => {
      const f = SCOPE_FILE[scope];
      return f ? parseRawGrammar(fs.readFileSync(path.join(G, f), 'utf8'), f) : null;
    },
  });
});

async function scopesOf(scope: string, line: string): Promise<string[]> {
  const grammar = (await registry.loadGrammar(scope))!;
  const r = grammar.tokenizeLine(line, INITIAL);
  return r.tokens.flatMap((t) => t.scopes);
}

describe('실문법 scope 검증 (언어별 대표 라인)', () => {
  it('TS 문자열/키워드', async () => {
    const scopes = await scopesOf('source.ts', "const s = 'hello';");
    expect(scopes.some((s) => s.startsWith('string.quoted'))).toBe(true);
    expect(scopes.some((s) => s.startsWith('storage.type') || s.startsWith('keyword'))).toBe(true);
  });
  it('Python 함수 정의', async () => {
    const scopes = await scopesOf('source.python', 'def greet(name):');
    expect(scopes.some((s) => s.includes('function'))).toBe(true);
  });
  it('Java 클래스 키워드', async () => {
    const scopes = await scopesOf('source.java', 'public class Main {');
    expect(scopes.some((s) => s.startsWith('storage.modifier') || s.startsWith('keyword'))).toBe(true);
  });
  it('C 전처리기', async () => {
    const scopes = await scopesOf('source.c', '#include <stdio.h>');
    expect(scopes.some((s) => s.includes('include') || s.includes('preprocessor'))).toBe(true);
  });
  it('C++ / JS 주석', async () => {
    expect((await scopesOf('source.cpp', '// comment')).some((s) => s.startsWith('comment'))).toBe(true);
    expect((await scopesOf('source.js', '// comment')).some((s) => s.startsWith('comment'))).toBe(true);
  });
  it('Groovy 키워드/문자열 (Jenkinsfile 파이프라인)', async () => {
    const scopes = await scopesOf('source.groovy', "def name = 'build'");
    expect(scopes.some((s) => s.startsWith('storage.type') || s.startsWith('keyword'))).toBe(true);
    expect(scopes.some((s) => s.startsWith('string'))).toBe(true);
  });
});

describe('어댑터 순수 변환', () => {
  it('마지막 scope를 Monaco 토큰으로', () => {
    expect(
      tmTokensToMonaco([{ startIndex: 0, scopes: ['source.ts', 'string.quoted.single.ts'] }]),
    ).toEqual([{ startIndex: 0, scopes: 'string.quoted.single.ts' }]);
    expect(tmTokensToMonaco([{ startIndex: 0, scopes: [] }])).toEqual([{ startIndex: 0, scopes: '' }]);
  });
});

describe('벤치 (회귀 기준선 기록)', () => {
  it('TS 3000줄 tokenize 시간 측정', async () => {
    const grammar = (await registry.loadGrammar('source.ts'))!;
    const line = "export function compute(a: number, b: string): string { return `${a}-${b}`.toUpperCase(); } // note";
    let stack = INITIAL;
    const t0 = performance.now();
    for (let i = 0; i < 3000; i++) stack = grammar.tokenizeLine(line, stack).ruleStack;
    const ms = performance.now() - t0;
    console.log(`[bench] TS 3000줄 tokenize: ${Math.round(ms)}ms`);
    expect(ms).toBeLessThan(5_000); // 넉넉한 상한 — 회귀 감지용
  });
});
