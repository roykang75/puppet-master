import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useAppStore } from '../store';
import { buildChatContext } from '../chat-context';
import { parseMarkdown, type InlineSpan } from '../chat-markdown';
import { refreshCompletionSettings } from '../completion-provider';
import { getChatEditorState } from './EditorPane';
import type { ChatContext, CompletionProfilePublic } from '../../../shared/protocol';

export const CHAT_ERROR_TEXT: Record<string, string> = {
  auth: '인증 오류 — Cmd+,에서 설정을 확인하세요',
  transient: '일시적 오류 — 잠시 후 다시 시도하세요',
  other: '오류가 발생했습니다',
};

function renderSpans(spans: InlineSpan[]): JSX.Element[] {
  return spans.map((s, i) =>
    s.kind === 'code' ? (
      <code key={i} className="chat-inline-code">{s.text}</code>
    ) : s.kind === 'bold' ? (
      <strong key={i}>{s.text}</strong>
    ) : s.kind === 'italic' ? (
      <em key={i}>{s.text}</em>
    ) : (
      <span key={i}>{s.text}</span>
    ),
  );
}

/** 어시스턴트 응답을 마크다운 블록으로 렌더 (chat-markdown 파서, HTML 미생성) */
function renderMarkdown(content: string): JSX.Element[] {
  return parseMarkdown(content).map((b, i) => {
    switch (b.kind) {
      case 'heading':
        return <div key={i} className={`chat-h chat-h${b.level}`}>{renderSpans(b.spans)}</div>;
      case 'code':
        return <pre key={i} className="chat-code">{b.text}</pre>;
      case 'hr':
        return <div key={i} className="chat-hr" />;
      case 'list': {
        const items = b.items.map((it, j) => (
          <li key={j} style={it.depth ? { marginLeft: it.depth * 16 } : undefined}>{renderSpans(it.spans)}</li>
        ));
        return b.ordered ? <ol key={i} className="chat-list">{items}</ol> : <ul key={i} className="chat-list">{items}</ul>;
      }
      default:
        return <p key={i} className="chat-p">{renderSpans(b.spans)}</p>;
    }
  });
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

export function ChatPanel() {
  const messages = useAppStore((s) => s.chatMessages);
  const streaming = useAppStore((s) => s.chatStreaming);
  const contextEnabled = useAppStore((s) => s.chatContextEnabled);
  const activePath = useAppStore((s) => s.activePath);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const [input, setInput] = useState('');
  const [profiles, setProfiles] = useState<CompletionProfilePublic[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // provider 미설정 감지 (전송 전 단락 — 스펙 §4) + 설정 오버레이 닫힐 때 재로드
  useEffect(() => {
    if (settingsOpen) return;
    void window.si.getCompletionSettings().then((s) => {
      setProfiles(s.profiles);
      setActiveId(s.activeId);
    }).catch(() => {});
  }, [settingsOpen]);

  const switchProfile = (id: string) => {
    setActiveId(id);
    void window.si.setActiveCompletionProfile(id).then(() => refreshCompletionSettings());
  };

  // 이벤트 구독은 App.tsx로 이동 — RightPanel이 탭 전환 시 ChatPanel을 언마운트하므로
  // 여기 두면 스트리밍 중 탭 전환 시 리스너가 사라져 이벤트가 유실된다.

  // 새 메시지에 자동 스크롤
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const st = useAppStore.getState();
    let context: ChatContext | null = null;
    if (contextEnabled) {
      const editorState = getChatEditorState();
      let signatures: string[] = [];
      if (editorState) {
        signatures = await window.si
          .getFileOutline(editorState.path)
          .then((o) => o.map((s) => s.signature).filter(Boolean))
          .catch(() => []);
      }
      context = buildChatContext(editorState, signatures);
    }
    st.appendChatUser(text);
    st.appendChatAssistant();
    st.setChatStreaming(true);
    setInput('');
    const history = useAppStore.getState().chatMessages
      .filter((m) => !m.error)
      .slice(0, -1) // 방금 추가한 빈 어시스턴트 제외
      .map((m) => ({ role: m.role, content: m.content }));
    void window.si.chatSend(history, context);
  };

  const cancel = () => {
    void window.si.chatCancel();
    const st = useAppStore.getState();
    st.appendChatChunk('\n(중단됨)');
  };

  const copy = (idx: number, content: string) => {
    void navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1200);
  };

  const editorState = contextEnabled ? getChatEditorState() : null;
  const contextLabel = editorState
    ? `컨텍스트: ${editorState.path}${editorState.selectionText ? ` (선택 ${editorState.selectionText.split('\n').length}줄)` : ''}`
    : activePath && contextEnabled
      ? `컨텍스트: ${activePath}`
      : '컨텍스트 없음';

  if (!activeId || profiles.length === 0) {
    return <div className="hint">AI 모델이 설정되지 않았습니다. Cmd+,에서 프로파일을 등록하세요.</div>;
  }

  const lastIdx = messages.length - 1;

  return (
    <div className="chat-panel">
      <div className="chat-toolbar">
        <label className="chat-context-toggle">
          <input
            type="checkbox"
            checked={contextEnabled}
            onChange={(e) => useAppStore.getState().setChatContextEnabled(e.target.checked)}
          />
          <span className="chat-context-label">{contextLabel}</span>
        </label>
        <button className="chat-new" title="새 대화" onClick={() => useAppStore.getState().clearChat()}>＋</button>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <div className="hint">코드에 대해 물어보세요.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            {m.role === 'user' ? (
              <div className="chat-content">{m.content}</div>
            ) : (
              <div className="chat-content">{renderMarkdown(m.content)}</div>
            )}
            {m.error && <div className="chat-error">{m.error}</div>}
            {m.role === 'assistant' && m.content && !(streaming && i === lastIdx) && (
              <div className="chat-msg-footer">
                <span className="chat-time">{formatTime(m.ts)}</span>
                <button className="chat-copy" title="복사" onClick={() => copy(i, m.content)}>
                  {copiedIdx === i ? '✓' : '⧉'}
                </button>
              </div>
            )}
          </div>
        ))}
        {streaming && <div className="chat-streaming">…</div>}
      </div>
      <div className="chat-input-row">
        <textarea
          rows={2}
          value={input}
          placeholder="무엇이든 물어보세요 (Shift+Enter 줄바꿈)"
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-input-footer">
          <select
            className="chat-model"
            title="모델 선택"
            value={activeId}
            disabled={streaming}
            onChange={(e) => switchProfile(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {streaming ? (
            <button className="chat-send chat-stop" title="중단" onClick={cancel}>■</button>
          ) : (
            <button className="chat-send" title="전송 (Enter)" onClick={() => void send()} disabled={!input.trim()}>↑</button>
          )}
        </div>
      </div>
    </div>
  );
}
