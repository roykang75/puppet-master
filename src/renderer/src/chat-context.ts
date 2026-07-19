// 채팅 컨텍스트 빌더 — 순수 모듈 (monaco 임포트 금지, 상태는 EditorPane이 추출해 전달)
import type { ChatContext } from '../../shared/protocol';

export const CURSOR_RADIUS = 30;
export const MAX_CONTEXT_SIGNATURES = 20;

export interface ChatEditorState {
  path: string;
  languageId: string;
  selectionText: string | null;
  selectionStartLine: number;
  cursorLine: number;
  lines: string[];
}

export const MAX_STRUCTURE_EACH = 5; // callers/callees 각각 상한 (v3)

/** v3: 커서 심볼의 구조 블록 — callers/callees 상위 N 시그니처를 프롬프트용 라인으로 (순수). */
export function buildStructureLines(
  symbolName: string,
  callers: { callerName: string | null; path: string; line: number }[],
  callees: { name: string; signature: string; path: string; line: number }[],
): string[] {
  if (callers.length === 0 && callees.length === 0) return [];
  return [
    `'${symbolName}' 기준:`,
    ...callers.slice(0, MAX_STRUCTURE_EACH).map((c) => `호출자: ${c.callerName ?? '(파일 최상위)'} — ${c.path}:${c.line + 1}`),
    ...callees.slice(0, MAX_STRUCTURE_EACH).map((s) => `피호출: ${s.signature || s.name} — ${s.path}:${s.line + 1}`),
  ];
}

export function buildChatContext(state: ChatEditorState | null, signatures: string[], structure: string[] = []): ChatContext | null {
  if (!state) return null;
  const sigs = signatures.slice(0, MAX_CONTEXT_SIGNATURES);
  const struct = structure.length > 0 ? { structure } : {};
  if (state.selectionText && state.selectionText.trim()) {
    return {
      path: state.path,
      languageId: state.languageId,
      code: state.selectionText,
      isSelection: true,
      startLine: state.selectionStartLine,
      signatures: sigs,
      ...struct,
    };
  }
  const start = Math.max(1, state.cursorLine - CURSOR_RADIUS);
  const end = Math.min(state.lines.length, state.cursorLine + CURSOR_RADIUS);
  return {
    path: state.path,
    languageId: state.languageId,
    code: state.lines.slice(start - 1, end).join('\n'),
    isSelection: false,
    startLine: start,
    signatures: sigs,
    ...struct,
  };
}
