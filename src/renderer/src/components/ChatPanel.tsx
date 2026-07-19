import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VscAdd, VscHistory, VscEllipsis, VscClose, VscArrowUp, VscCheck, VscCopy, VscDebugStop, VscFolderOpened, VscFileCode, VscEdit, VscSearch, VscTerminal, VscTools, VscBook, VscSymbolMethod, VscTypeHierarchy, VscWarning, VscArrowSwap } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { scheduleChatSave } from '../chat-persist';
import { deriveTitle } from '../../../shared/chat-title';
import { buildChatContext, buildStructureLines } from '../chat-context';
import { retrieveSnippets } from '../chat-retrieval';
import { renderMarkdown } from './MarkdownView';
import { refreshCompletionSettings } from '../completion-provider';
import { getChatEditorState } from './EditorPane';
import { fileIconUrl } from '../file-icons';
import type { AgentToolUi, ChatContext, CompletionProfilePublic, ThreadSearchHit } from '../../../shared/protocol';

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

// 도구 카드 표시 — 원시 이름(read_file) 대신 아이콘 + 영문 라벨 (개발자 가독성)
const TOOL_META: Record<string, { icon: ReactNode; label: string }> = {
  list_dir: { icon: <VscFolderOpened />, label: 'List Dir' },
  read_file: { icon: <VscFileCode />, label: 'Read File' },
  write_file: { icon: <VscEdit />, label: 'Write File' },
  search_text: { icon: <VscSearch />, label: 'Search' },
  run_command: { icon: <VscTerminal />, label: 'Run Command' },
  library_docs: { icon: <VscBook />, label: 'Docs' },
  find_symbol: { icon: <VscSymbolMethod />, label: 'Symbol' },
  get_call_graph: { icon: <VscTypeHierarchy />, label: 'Call Graph' },
  get_impact: { icon: <VscWarning />, label: 'Impact' },
  trace_http: { icon: <VscArrowSwap />, label: 'HTTP Flow' },
};

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

export function ChatPanel() {
  const messages = useAppStore((s) => s.chatMessages);
  const streaming = useAppStore((s) => s.chatStreaming);
  const agentMode = useAppStore((s) => s.agentMode);
  const trustPreset = useAppStore((s) => s.trustPreset);
  const isolate = useAppStore((s) => s.isolate);
  const worktreeChanges = useAppStore((s) => s.worktreeChanges);
  const [isolationAvailable, setIsolationAvailable] = useState(true);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const threads = useAppStore((s) => s.threads);
  const chatDraft = useAppStore((s) => s.chatDraft);
  const root = useAppStore((s) => s.root);
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [profiles, setProfiles] = useState<CompletionProfilePublic[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<ThreadSearchHit[]>([]);
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

  // 대화 기록 전문검색 — 입력 디바운스(200ms). 빈 질의면 결과 비움(전체 목록으로 복귀).
  useEffect(() => {
    if (!listOpen) return;
    const q = searchQ.trim();
    if (!q) { setSearchHits([]); return; }
    let cancelled = false;
    const h = setTimeout(() => {
      void window.si.chatThreadsSearch(q).then((hits) => { if (!cancelled) setSearchHits(hits); });
    }, 200);
    return () => { cancelled = true; clearTimeout(h); };
  }, [searchQ, listOpen]);

  // provider 미설정 감지 (전송 전 단락 — 스펙 §4) + 설정 오버레이 닫힐 때 재로드
  useEffect(() => {
    if (settingsOpen) return;
    void window.si.getCompletionSettings().then((s) => {
      setProfiles(s.profiles);
      setActiveId(s.activeId);
    }).catch(() => {});
  }, [settingsOpen]);

  // 격리 설정/가용성 로드 — 프로젝트 전환(root)마다 git 여부 재확인
  useEffect(() => {
    void window.si.getAgentSettings().then((a) => {
      const st = useAppStore.getState();
      st.setIsolate(a.isolate);
      st.setTrustPreset(a.trustPreset);
    }).catch(() => {});
    void window.si.agentIsolationAvailable().then(setIsolationAvailable).catch(() => setIsolationAvailable(false));
  }, [root]);

  const toggleIsolate = (v: boolean) => {
    useAppStore.getState().setIsolate(v);
    void window.si.setAgentSettings({ isolate: v });
  };

  // 격리 변경 파일 diff 열기 — before=원본(없으면 ''), after=wt 내용(삭제면 '')
  const openWorktreeDiff = async (c: { path: string; status: 'M' | 'A' | 'D' }) => {
    const before = c.status === 'A' ? '' : await window.si.readFile(c.path).catch(() => '');
    const after = c.status === 'D' ? '' : await window.si.agentWorktreeRead(c.path).catch(() => '');
    useAppStore.getState().openDiffTab(c.path, before, after, undefined, 'agent');
  };
  const applyWorktree = async () => {
    await window.si.agentWorktreeApply().catch(() => {});
    const st = useAppStore.getState();
    st.setWorktreeChanges(null);
    st.bumpTreeRefresh();
  };
  const discardWorktree = async () => {
    await window.si.agentWorktreeDiscard().catch(() => {});
    useAppStore.getState().setWorktreeChanges(null);
  };

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

  // diff 주석 → 채팅 프리필: chatDraft가 설정되면 입력창에 채우고 즉시 소비(클리어) + 포커스.
  // store 경유이므로 탭 전환으로 ChatPanel이 (언)마운트되어도 값이 유실되지 않는다.
  useEffect(() => {
    if (chatDraft == null) return;
    setInput(chatDraft);
    useAppStore.getState().setChatDraft(null);
    textareaRef.current?.focus();
  }, [chatDraft]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const st = useAppStore.getState();
    // 자동 컨텍스트 — 활성 파일(있으면) + 질문 기반 인덱서 검색 시드를 항상 첨부.
    const editorState = getChatEditorState();
    let signatures: string[] = [];
    if (editorState) {
      signatures = await window.si
        .getFileOutline(editorState.path)
        .then((o) => o.map((s) => s.signature).filter(Boolean))
        .catch(() => []);
    }
    // v3: 커서 심볼의 구조 블록 (callers/callees) — 실패 시 빈 배열(additive)
    let structure: string[] = [];
    const cur = useAppStore.getState().cursorSymbol;
    if (cur) {
      const [callers, cands] = await Promise.all([
        window.si.getCallers(cur.name).catch(() => []),
        window.si.resolve(cur.name, cur.path).catch(() => []),
      ]);
      const callees = cands[0] ? await window.si.getCallees(cands[0].id).catch(() => []) : [];
      structure = buildStructureLines(cur.name, callers, callees);
    }
    const activeCtx = buildChatContext(editorState, signatures, structure);
    const retrieved = await retrieveSnippets(text, editorState?.path).catch(() => []);
    const stack = await window.si.getProjectStack().catch(() => null);
    const base = retrieved.length > 0 ? { ...(activeCtx ?? {}), retrieved } : activeCtx;
    const context: ChatContext | null =
      stack ? { ...(base ?? {}), stack } : base;
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
    // 에이전트 모드: 전체 도구(쓰기/실행) · 질문 모드: 읽기 전용 에이전트(파일 탐색만)
    if (useAppStore.getState().agentMode) void window.si.agentSend(history, context, useAppStore.getState().trustPreset);
    else void window.si.agentSend(history, context, 'careful', true); // 질문 모드: readOnly 우선, preset 값은 무의미
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
          <button className="chat-new" title="대화 기록" onClick={() => { refreshThreads(); setSearchQ(''); setSearchHits([]); setListOpen((o) => !o); }}><VscHistory /></button>
          <button className="chat-new" title="현재 대화" onClick={() => setMenuOpen((o) => !o)} disabled={!activeThreadId}><VscEllipsis /></button>
        </span>
        {listOpen && (
          <>
            <div className="open-editors-backdrop" onMouseDown={() => setListOpen(false)} />
            <div className="open-editors-menu chat-thread-menu">
              <div className="chat-thread-search">
                <VscSearch />
                <input
                  className="chat-thread-search-input"
                  placeholder="대화 내용 검색…"
                  value={searchQ}
                  autoFocus
                  onChange={(e) => setSearchQ(e.target.value)}
                />
              </div>
              {searchQ.trim() ? (
                <>
                  {searchHits.length === 0 && <div className="hint">일치하는 대화가 없습니다.</div>}
                  {searchHits.map((h) => (
                    <div key={h.threadId} className={`open-editors-item${h.threadId === activeThreadId ? ' active' : ''}`} onClick={() => void switchThread(h.threadId)}>
                      <VscHistory />
                      <span className="open-editors-name">
                        {h.title}
                        <span className="chat-thread-snippet">{h.snippet}</span>
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="open-editors-title">대화 기록 {threads.length}개</div>
                  {threads.length === 0 && <div className="hint">저장된 대화가 없습니다.</div>}
                  {threads.map((t) => (
                    <div key={t.id} className={`open-editors-item${t.id === activeThreadId ? ' active' : ''}`} onClick={() => void switchThread(t.id)}>
                      <VscHistory />
                      <span className="open-editors-name">{t.title}</span>
                      <span className="tab-close" onClick={(e) => { e.stopPropagation(); void deleteThread(t.id); }}><VscClose /></span>
                    </div>
                  ))}
                </>
              )}
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
                      <span className="tool-name">
                        <span className="tool-icon">{TOOL_META[t.name]?.icon ?? <VscTools />}</span>
                        {TOOL_META[t.name]?.label ?? t.name}
                      </span>
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
                              useAppStore.getState().openDiffTab(t.path!, t.before ?? '', t.after!, undefined, 'agent');
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
                      if (t.after !== undefined) useAppStore.getState().openDiffTab(t.path!, t.before ?? '', t.after, undefined, 'agent');
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
      {worktreeChanges && worktreeChanges.length > 0 && (
        <div className="worktree-bar">
          <div className="worktree-bar-head">
            <span className="worktree-bar-label">격리된 변경 {worktreeChanges.length}개 파일</span>
            <span className="worktree-bar-actions">
              <button className="rename-btn primary" onClick={() => void applyWorktree()}>적용</button>
              <button className="rename-btn" onClick={() => void discardWorktree()}>폐기</button>
            </span>
          </div>
          <div className="worktree-bar-files">
            {worktreeChanges.map((c) => (
              <span
                key={c.path}
                className="changed-file-chip"
                title={`${c.path} (${c.status}) — 클릭하면 변경 내용(diff)`}
                onClick={() => void openWorktreeDiff(c)}
              >
                <img className="file-icon tab-file-icon" src={fileIconUrl(c.path.split('/').pop() ?? '')} alt="" />
                <span className={`worktree-status worktree-status-${c.status}`}>{c.status}</span>
                {c.path}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="chat-input-row">
        <textarea
          ref={textareaRef}
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
          <div className="chat-footer-left">
            <select
              className="chat-mode"
              title="에이전트: AI가 도구로 파일을 직접 생성/수정 · 질문: 답변만"
              value={agentMode ? 'agent' : 'ask'}
              disabled={streaming}
              onChange={(e) => useAppStore.getState().setAgentMode(e.target.value === 'agent')}
            >
              <option value="agent">에이전트</option>
              <option value="ask">질문</option>
            </select>
            {agentMode && (
              <select
                className="chat-trust"
                title="탐색만=쓰기·셸 없음 · 신중=쓰기·셸 승인 · 편집 자동=셸만 승인 · 전체 자동 · 격리 모드에서는 [적용] 전까지 프로젝트가 안전합니다"
                value={trustPreset}
                disabled={streaming}
                onChange={(e) => {
                  const p = e.target.value as typeof trustPreset;
                  useAppStore.getState().setTrustPreset(p);
                  void window.si.setAgentSettings({ trustPreset: p });
                }}
              >
                <option value="explore">탐색만</option>
                <option value="careful">신중</option>
                <option value="edits">편집 자동</option>
                <option value="full">전체 자동</option>
              </select>
            )}
            {agentMode && (
              <label
                className="chat-context-toggle"
                title={isolationAvailable
                  ? '켜면 에이전트가 프로젝트 밖 git worktree 샌드박스에서 작업하고, 턴 종료 후 변경을 리뷰·적용합니다'
                  : 'git 저장소에서만 사용 가능합니다'}
              >
                <input
                  type="checkbox"
                  checked={isolate}
                  disabled={streaming || !isolationAvailable}
                  onChange={(e) => toggleIsolate(e.target.checked)}
                />
                <span className="chat-context-label">격리(worktree)</span>
              </label>
            )}
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
          </div>
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
