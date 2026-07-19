import { describe, it, expect } from 'vitest';
import { dedupeByName, symbolKindToMonaco, NON_LSP_COMPLETION_LANGS } from '../src/renderer/src/symbol-completion';
import type { SymbolHit } from '../src/indexer/api';

const hit = (name: string, kind = 'function', path = 'a.c'): SymbolHit => ({
  id: 1, name, kind, scope: '', signature: `${kind} ${name}()`, path, line: 1, nameLine: 1, nameCol: 0,
});

// Monaco enum 스텁 — 매핑이 올바른 상수를 고르는지만 검증
const K = { Function: 1, Method: 2, Class: 3, Struct: 4, Enum: 5, Interface: 6, Field: 7, Module: 8, Constant: 9, TypeParameter: 10, Variable: 11 };
const monacoStub = { languages: { CompletionItemKind: K } } as any;

describe('symbol-completion', () => {
  it('비-LSP 언어 목록 = c/cpp/java (LSP 언어 미포함)', () => {
    expect(NON_LSP_COMPLETION_LANGS).toEqual(['c', 'cpp', 'java']);
    for (const lsp of ['typescript', 'javascript', 'python']) {
      expect(NON_LSP_COMPLETION_LANGS).not.toContain(lsp);
    }
  });

  it('dedupeByName: 동명 심볼은 1개, 입력 순서 유지', () => {
    const out = dedupeByName([hit('foo', 'function', 'a.c'), hit('bar'), hit('foo', 'function', 'b.c')]);
    expect(out.map((h) => `${h.name}:${h.path}`)).toEqual(['foo:a.c', 'bar:a.c']);
  });

  it('dedupeByName: 빈 입력 → 빈 배열', () => {
    expect(dedupeByName([])).toEqual([]);
  });

  it('symbolKindToMonaco: 주요 kind 매핑', () => {
    expect(symbolKindToMonaco(monacoStub, 'function')).toBe(K.Function);
    expect(symbolKindToMonaco(monacoStub, 'method')).toBe(K.Method);
    expect(symbolKindToMonaco(monacoStub, 'class')).toBe(K.Class);
    expect(symbolKindToMonaco(monacoStub, 'struct')).toBe(K.Struct);
    expect(symbolKindToMonaco(monacoStub, 'macro')).toBe(K.Constant);
    expect(symbolKindToMonaco(monacoStub, 'namespace')).toBe(K.Module);
  });

  it('symbolKindToMonaco: 미지의 kind → Variable', () => {
    expect(symbolKindToMonaco(monacoStub, 'weird')).toBe(K.Variable);
  });
});
