import { describe, it, expect } from 'vitest';
import { buildChatContext, CURSOR_RADIUS, MAX_CONTEXT_SIGNATURES, type ChatEditorState } from '../src/renderer/src/chat-context';

const mkState = (over: Partial<ChatEditorState> = {}): ChatEditorState => ({
  path: 'src/a.ts', languageId: 'typescript',
  selectionText: null, selectionStartLine: 0,
  cursorLine: 50,
  lines: Array.from({ length: 100 }, (_, i) => `line${i + 1}`),
  ...over,
});

describe('buildChatContext', () => {
  it('선택 영역 우선', () => {
    const ctx = buildChatContext(mkState({ selectionText: 'const x = 1;', selectionStartLine: 7 }), [])!;
    expect(ctx.code).toBe('const x = 1;');
    expect(ctx.isSelection).toBe(true);
    expect(ctx.startLine).toBe(7);
  });

  it('선택 없으면 커서 ±30줄', () => {
    const ctx = buildChatContext(mkState(), [])!;
    expect(ctx.isSelection).toBe(false);
    expect(ctx.startLine).toBe(50 - CURSOR_RADIUS);
    const lines = ctx.code.split('\n');
    expect(lines[0]).toBe('line20');
    expect(lines.at(-1)).toBe('line80');
  });

  it('문서 경계 절단 (파일 앞부분 커서)', () => {
    const ctx = buildChatContext(mkState({ cursorLine: 3 }), [])!;
    expect(ctx.startLine).toBe(1);
    expect(ctx.code.split('\n')[0]).toBe('line1');
  });

  it('시그니처 20개 절단 + null 상태는 null', () => {
    const sigs = Array.from({ length: 30 }, (_, i) => `sig${i}`);
    const ctx = buildChatContext(mkState(), sigs)!;
    expect(ctx.signatures).toHaveLength(MAX_CONTEXT_SIGNATURES);
    expect(buildChatContext(null, sigs)).toBeNull();
  });
});
