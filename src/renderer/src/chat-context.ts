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

export function buildChatContext(state: ChatEditorState | null, signatures: string[]): ChatContext | null {
  if (!state) return null;
  const sigs = signatures.slice(0, MAX_CONTEXT_SIGNATURES);
  if (state.selectionText && state.selectionText.trim()) {
    return {
      path: state.path,
      languageId: state.languageId,
      code: state.selectionText,
      isSelection: true,
      startLine: state.selectionStartLine,
      signatures: sigs,
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
  };
}
