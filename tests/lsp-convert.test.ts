import { describe, it, expect } from 'vitest';
import { toCompletionItems, toHover, toLocations, toDiagnostics, toSignatureHelp, MAX_DIAGNOSTICS } from '../src/main/lsp/convert';

const uriToRel = (uri: string) =>
  uri.startsWith('file:///proj/') ? uri.slice('file:///proj/'.length) : null;

describe('toCompletionItems', () => {
  it('CompletionList와 배열 모두 처리, textEdit > insertText > label 우선', () => {
    const list = {
      isIncomplete: false,
      items: [
        { label: 'toUpperCase', kind: 2, textEdit: { newText: 'toUpperCase()', range: {} }, detail: 'fn' },
        { label: 'concat', kind: 2, insertText: 'concat' },
        { label: 'length', kind: 10 },
      ],
    };
    const out = toCompletionItems(list);
    expect(out.map((i) => i.insertText)).toEqual(['toUpperCase()', 'concat', 'length']);
    expect(out[0].detail).toBe('fn');
    expect(toCompletionItems(list.items)).toHaveLength(3); // 배열 형태
  });

  it('insertTextFormat 2 → isSnippet', () => {
    const out = toCompletionItems([{ label: 'f', kind: 3, insertText: 'f($1)', insertTextFormat: 2 }]);
    expect(out[0].isSnippet).toBe(true);
  });

  it('null/비정형 → 빈 배열', () => {
    expect(toCompletionItems(null)).toEqual([]);
    expect(toCompletionItems({})).toEqual([]);
  });
});

describe('toHover', () => {
  it('MarkupContent / 문자열 / 배열 contents 모두 markdown으로', () => {
    expect(toHover({ contents: { kind: 'markdown', value: '**x**' } })?.markdown).toBe('**x**');
    expect(toHover({ contents: 'plain' })?.markdown).toBe('plain');
    expect(
      toHover({ contents: ['a', { language: 'ts', value: 'const x: number' }] })?.markdown,
    ).toBe('a\n\n```ts\nconst x: number\n```');
  });

  it('null/빈 contents → null', () => {
    expect(toHover(null)).toBeNull();
    expect(toHover({ contents: '' })).toBeNull();
  });
});

describe('toLocations', () => {
  const range = { start: { line: 3, character: 5 }, end: { line: 3, character: 9 } };
  it('Location 단일/배열/LocationLink 처리 + 프로젝트 밖 필터', () => {
    expect(toLocations({ uri: 'file:///proj/a.ts', range }, uriToRel)).toEqual([
      { path: 'a.ts', line: 3, col: 5 },
    ]);
    expect(toLocations([{ uri: 'file:///out/b.ts', range }], uriToRel)).toEqual([]);
    const link = [{ targetUri: 'file:///proj/c.ts', targetRange: range, targetSelectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } } }];
    expect(toLocations(link, uriToRel)).toEqual([{ path: 'c.ts', line: 1, col: 0 }]);
  });

  it('null → 빈 배열', () => {
    expect(toLocations(null, uriToRel)).toEqual([]);
  });
});

describe('toSignatureHelp', () => {
  it('시그니처/파라미터/active 변환', () => {
    const raw = {
      activeSignature: 0,
      activeParameter: 1,
      signatures: [
        {
          label: 'foo(a: number, b: string): void',
          documentation: { kind: 'markdown', value: 'does foo' },
          parameters: [{ label: 'a: number' }, { label: [7, 16] }],
        },
      ],
    };
    expect(toSignatureHelp(raw)).toEqual({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [
        {
          label: 'foo(a: number, b: string): void',
          documentation: 'does foo',
          parameters: [
            { label: 'a: number', documentation: undefined },
            { label: [7, 16], documentation: undefined },
          ],
        },
      ],
    });
  });
  it('빈 signatures → null, 누락 active 기본 0', () => {
    expect(toSignatureHelp({ signatures: [] })).toBeNull();
    expect(toSignatureHelp(null)).toBeNull();
    const r = toSignatureHelp({ signatures: [{ label: 'x()' }] });
    expect(r).toEqual({ activeSignature: 0, activeParameter: 0, signatures: [{ label: 'x()', documentation: undefined, parameters: [] }] });
  });
});

describe('toDiagnostics', () => {
  const d = (line: number) => ({
    message: 'err', severity: 1,
    range: { start: { line, character: 0 }, end: { line, character: 3 } },
  });
  it('중립 형태 변환 + severity 기본값 1', () => {
    const out = toDiagnostics([{ ...d(2), severity: undefined }]);
    expect(out[0]).toEqual({ message: 'err', severity: 1, startLine: 2, startCol: 0, endLine: 2, endCol: 3 });
  });
  it('500개 절단', () => {
    const many = Array.from({ length: 600 }, (_, i) => d(i));
    expect(toDiagnostics(many)).toHaveLength(MAX_DIAGNOSTICS);
  });
});
