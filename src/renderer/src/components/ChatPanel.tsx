import { useEffect, useRef, useState } from 'react';
import { VscAdd, VscHistory, VscEllipsis, VscClose, VscArrowUp, VscCheck, VscCopy, VscDebugStop } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { scheduleChatSave } from '../chat-persist';
import { deriveTitle } from '../../../shared/chat-title';
import { buildChatContext } from '../chat-context';
import { renderMarkdown } from './MarkdownView';
import { refreshCompletionSettings } from '../completion-provider';
import { getChatEditorState } from './EditorPane';
import { fileIconUrl } from '../file-icons';
import type { AgentToolUi, ChatContext, CompletionProfilePublic } from '../../../shared/protocol';

export const CHAT_ERROR_TEXT: Record<string, string> = {
  auth: '인증 오류 — Cmd+,에서 설정을 확인하세요',
  transient: '일시적 오류 — 잠시 후 다시 시도하세요',
  other: '오류가 발생했습니다',
};

/** write_file diff를 +/- 색칠해 렌더 */
function renderDiff(text: string) {
  return (
    <pre className="tool-diff">
      {text.split('\n').map((l, i) => (
        <span
          key={i}
          className={
            l.startsWith('+') ? 'diff-add' : l.startsWith('-') ? 'diff-del' : l.startsWith('@@') ? 'diff-hunk' : undefined
          }
        >
          {l + '\n'}
        </span>
      ))}
    </pre>
  );
}

/** 이 응답에서 write_file로 실제 변경된 파일 (경로별 최신 도구, 클릭 시 diff 열기용) */
function changedFiles(tools?: AgentToolUi[]): AgentToolUi[] {
  const byPath = new Map<string, AgentToolUi>();
  for (const t of tools ?? []) {
    if (t.name === 'write_file' && t.state === 'done' && t.path) byPath.set(t.path, t); // 같은 경로 재작성이면 마지막 것
  }
  return [...byPath.values()];
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

export function ChatPanel() {
  const messages = useAppStore((s) => s.chatMessages);
  const streaming = useAppStore((s) => s.chatStreaming);
  const contextEnabled = useAppStore((s) => s.chatContextEnabled);
  const agentMode = useAppStore((s) => s.agentMode);
  const autoApprove = useAppStore((s) => s.autoApprove);
  const activePath = useAppStore((s) => s.activePath);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const threads = useAppStore((s) => s.threads);
  const [input, setInput] = useState('');
  const [profiles, setProfiles] = useState<CompletionProfilePublic[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const activeTitle = threads.find((t) => t.id === activeThreadId)?.title ?? '새 대화';

  const refreshThreads = () => void window.si.chatThreadsList().then((l) => useAppStore.getState().setThreads(l));
  const switchThread = async (id: string) => {
    void window.si.chatCancel();
    const msgs = await window.si.chatThreadLoad(id);
    const st = useAppStore.getState();
    st.setActiveThreadId(id);
    st.loadThreadMessages(msgs as typeof st.chatMessages);
    setListOpen(false);
  };
  const newThread = () => {
    void window.si.chatCancel();
    const st = useAppStore.getState();
    st.clearChat(); // chatMessages 비움 + activeThreadId null
    setListOpen(false);
  };
  const deleteThread = async (id: string) => {
    await window.si.chatThreadDelete(id);
    await window.si.chatThreadsList().then((l) => useAppStore.getState().setThreads(l));
    if (useAppStore.getState().activeThreadId === id) {
      const next = useAppStore.getState().threads[0];
      if (next) void switchThread(next.id);
      else newThread();
    }
  };
  const renameActive = (title: string) => {
    if (!activeThreadId || !title.trim()) return;
    void window.si.chatThreadRename(activeThreadId, title.trim()).then(refreshThreads);
  };

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
    let tid = useAppStore.getState().activeThreadId;
    if (!tid) {
      const { id } = await window.si.chatThreadCreate(deriveTitle(text));
      tid = id;
      useAppStore.getState().setActiveThreadId(id);
      refreshThreads(); // 새 스레드가 목록에 없으면 헤더 제목이 '새 대화'로 남는다
    }
    st.appendChatUser(text);
    st.appendChatAssistant();
    st.setChatStreaming(true);
    setInput('');
    const history = useAppStore.getState().chatMessages
      .filter((m) => !m.error)
      .slice(0, -1) // 방금 추가한 빈 어시스턴트 제외
      .map((m) => ({ role: m.role, content: m.content }));
    if (useAppStore.getState().agentMode) void window.si.agentSend(history, context, useAppStore.getState().autoApprove);
    else void window.si.chatSend(history, context);
    scheduleChatSave();
  };

  const cancel = () => {
    // 클릭 시점의 agentMode가 아니라 "실제로 진행 중인" 스트림을 멈춰야 한다 —
    // 스트리밍 중 에이전트 토글을 바꾸면 시작 당시 모드와 클릭 시점 모드가 달라질 수 있다.
    // 두 cancel() 모두 진행 중이 아니면 무해한 no-op이므로 둘 다 호출한다.
    void window.si.agentCancel();
    void window.si.chatCancel();
    const st = useAppStore.getState();
    st.appendChatChunk('\n(중단됨)');
    scheduleChatSave();
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
      <div className="chat-thread-header">
        {renaming ? (
          <input
            className="chat-thread-title-input"
            defaultValue={activeTitle}
            autoFocus
            onBlur={(e) => { renameActive(e.target.value); setRenaming(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { renameActive((e.target as HTMLInputElement).value); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
          />
        ) : (
          <span className="chat-thread-title" onDoubleClick={() => activeThreadId && setRenaming(true)} title={activeTitle}>{activeTitle}</span>
        )}
        <span className="chat-thread-actions">
          <button className="chat-new" title="새 대화" onClick={newThread}><VscAdd /></button>
          <button className="chat-new" title="대화 기록" onClick={() => { refreshThreads(); setListOpen((o) => !o); }}><VscHistory /></button>
          <button className="chat-new" title="현재 대화" onClick={() => setMenuOpen((o) => !o)} disabled={!activeThreadId}><VscEllipsis /></button>
        </span>
        {listOpen && (
          <>
            <div className="open-editors-backdrop" onMouseDown={() => setListOpen(false)} />
            <div className="open-editors-menu chat-thread-menu">
              <div className="open-editors-title">대화 기록 {threads.length}개</div>
              {threads.length === 0 && <div className="hint">저장된 대화가 없습니다.</div>}
              {threads.map((t) => (
                <div key={t.id} className={`open-editors-item${t.id === activeThreadId ? ' active' : ''}`} onClick={() => void switchThread(t.id)}>
                  <VscHistory />
                  <span className="open-editors-name">{t.title}</span>
                  <span className="tab-close" onClick={(e) => { e.stopPropagation(); void deleteThread(t.id); }}><VscClose /></span>
                </div>
              ))}
            </div>
          </>
        )}
        {menuOpen && (
          <>
            <div className="open-editors-backdrop" onMouseDown={() => setMenuOpen(false)} />
            <div className="open-editors-menu chat-thread-menu chat-thread-ctxmenu">
              <div className="open-editors-item" onClick={() => { setMenuOpen(false); setRenaming(true); }}>이름 변경</div>
              <div className="open-editors-item" onClick={() => { setMenuOpen(false); if (activeThreadId) void deleteThread(activeThreadId); }}>삭제</div>
            </div>
          </>
        )}
      </div>
      <div className="chat-toolbar">
        <label className="chat-context-toggle">
          <input
            type="checkbox"
            checked={contextEnabled}
            onChange={(e) => useAppStore.getState().setChatContextEnabled(e.target.checked)}
          />
          <span className="chat-context-label">{contextLabel}</span>
        </label>
        <label className="chat-context-toggle" title="AI가 도구로 파일을 직접 생성/수정">
          <input type="checkbox" checked={agentMode} onChange={(e) => useAppStore.getState().setAgentMode(e.target.checked)} />
          <span className="chat-context-label">에이전트</span>
        </label>
        {agentMode && (
          <label className="chat-context-toggle" title="끄면 파일 쓰기/셸 실행 전에 승인 버튼이 표시됩니다">
            <input type="checkbox" checked={autoApprove} onChange={(e) => useAppStore.getState().setAutoApprove(e.target.checked)} />
            <span className="chat-context-label">자동 승인</span>
          </label>
        )}
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <div className="hint">코드에 대해 물어보세요.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            {m.role === 'assistant' && m.tools && m.tools.length > 0 && (
              <div className="tool-cards">
                {m.tools.map((t) => (
                  <div
                    key={t.id}
                    className={`tool-card tool-${t.state}${t.path && t.state === 'done' ? ' clickable' : ''}`}
                    onClick={() => {
                      if (t.path && t.state === 'done') useAppStore.getState().openTab(t.path);
                    }}
                  >
                    <span className="tool-card-head">
                      <span className="tool-name">{t.name}</span>
                      <span className="tool-summary" title={t.summary}>{t.summary}</span>
                      <span className="tool-state">
                        {t.state === 'running' ? '실행 중…' : t.state === 'done' ? '완료' : t.state === 'error' ? '실패' : '승인 대기'}
                      </span>
                    </span>
                    {t.state === 'awaiting' && (
                      <span className="tool-actions">
                        <button className="rename-btn primary" onClick={(e) => { e.stopPropagation(); void window.si.agentApprove(t.id, true); }}>실행</button>
                        <button className="rename-btn" onClick={(e) => { e.stopPropagation(); void window.si.agentApprove(t.id, false); }}>건너뛰기</button>
                        {t.path && t.after !== undefined && (
                          <button
                            className="rename-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              useAppStore.getState().openDiffTab(t.path!, t.before ?? '', t.after!);
                            }}
                          >에디터에서 diff</button>
                        )}
                      </span>
                    )}
                    {/* 완료 후 diff는 하단 '변경된 파일' 칩에서 연다 (여러 파일 개별 접근) */}
                    {t.detail && (
                      <details
                        className="tool-detail"
                        open={t.state === 'awaiting' /* 승인 전에는 변경 내용을 바로 펼쳐 보여준다 */}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <summary>{t.name === 'write_file' ? '변경 내용' : '출력 보기'}</summary>
                        {t.name === 'write_file' ? renderDiff(t.detail) : <pre>{t.detail}</pre>}
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
            {m.role === 'assistant' && changedFiles(m.tools).length > 0 && (
              <div className="changed-files">
                <span className="changed-files-label">변경된 파일</span>
                {changedFiles(m.tools).map((t) => (
                  <span
                    key={t.path}
                    className="changed-file-chip"
                    title={`${t.path} — 클릭하면 변경 내용(diff)`}
                    onClick={() => {
                      // 원문이 있으면 diff 탭으로, 없으면(대용량 등) 파일 자체를 연다
                      if (t.after !== undefined) useAppStore.getState().openDiffTab(t.path!, t.before ?? '', t.after);
                      else useAppStore.getState().openTab(t.path!);
                    }}
                  >
                    <img className="file-icon tab-file-icon" src={fileIconUrl(t.path!.split('/').pop() ?? '')} alt="" />
                    {t.path}
                  </span>
                ))}
              </div>
            )}
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
                  {copiedIdx === i ? <VscCheck /> : <VscCopy />}
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
            <button className="chat-send chat-stop" title="중단" onClick={cancel}><VscDebugStop /></button>
          ) : (
            <button className="chat-send" title="전송 (Enter)" onClick={() => void send()} disabled={!input.trim()}><VscArrowUp /></button>
          )}
        </div>
      </div>
    </div>
  );
}
