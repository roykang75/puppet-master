import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useAppStore } from '../store';
import { buildChatContext } from '../chat-context';
import { getChatEditorState } from './EditorPane';
import type { ChatContext } from '../../../shared/protocol';

const ERROR_TEXT: Record<string, string> = {
  auth: '인증 오류 — Cmd+,에서 설정을 확인하세요',
  transient: '일시적 오류 — 잠시 후 다시 시도하세요',
  other: '오류가 발생했습니다',
};

/** 마크다운 코드 펜스만 분리해 등폭 블록으로 렌더 (구문 강조는 후속) */
function renderContent(content: string): JSX.Element[] {
  const parts = content.split(/```[\w]*\n?/);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <pre key={i} className="chat-code">{part}</pre>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function ChatPanel() {
  const messages = useAppStore((s) => s.chatMessages);
  const streaming = useAppStore((s) => s.chatStreaming);
  const contextEnabled = useAppStore((s) => s.chatContextEnabled);
  const activePath = useAppStore((s) => s.activePath);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<string>('none');
  const listRef = useRef<HTMLDivElement>(null);

  // provider 미설정 감지 (전송 전 단락 — 스펙 §4)
  useEffect(() => {
    void window.si.getCompletionSettings().then((s) => setProvider(s.provider)).catch(() => {});
  }, []);

  // 이벤트 구독 (마운트 1회 — RightPanel이 탭 전환 시에도 유지되도록 store만 갱신)
  useEffect(() => {
    const off = window.si.onChatEvent((e) => {
      const st = useAppStore.getState();
      if (e.type === 'chunk') st.appendChatChunk(e.text);
      else if (e.type === 'done') st.setChatStreaming(false);
      else {
        st.setChatError(ERROR_TEXT[e.kind] ?? ERROR_TEXT.other);
        st.setChatStreaming(false);
      }
    });
    return off;
  }, []);

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

  const editorState = contextEnabled ? getChatEditorState() : null;
  const contextLabel = editorState
    ? `컨텍스트: ${editorState.path}${editorState.selectionText ? ` (선택 ${editorState.selectionText.split('\n').length}줄)` : ''}`
    : activePath && contextEnabled
      ? `컨텍스트: ${activePath}`
      : '컨텍스트 없음';

  if (provider === 'none') {
    return <div className="hint">AI provider가 설정되지 않았습니다. Cmd+,에서 설정하세요.</div>;
  }

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
        <button className="rename-btn" onClick={() => useAppStore.getState().clearChat()}>새 대화</button>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <div className="hint">코드에 대해 물어보세요.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            <div className="chat-content">{renderContent(m.content)}</div>
            {m.error && <div className="chat-error">{m.error}</div>}
          </div>
        ))}
        {streaming && <div className="chat-streaming">…</div>}
      </div>
      <div className="chat-input-row">
        <textarea
          rows={3}
          value={input}
          placeholder="질문 입력 (Enter 전송, Shift+Enter 줄바꿈)"
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <button className="rename-btn" onClick={cancel}>중단</button>
        ) : (
          <button className="rename-btn primary" onClick={() => void send()} disabled={!input.trim()}>전송</button>
        )}
      </div>
    </div>
  );
}
