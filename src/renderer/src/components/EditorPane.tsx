import { useEffect, useRef } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { jumpTo, setCurrentLocProvider, type Loc } from '../navigation';
import { buildTokenDecorations } from '../semantic-tokens';
import { registerCompletionProvider } from '../completion-provider';
import { registerLspFeatures, tryLspDefinition } from '../lsp-features';
import { registerSymbolCompletion } from '../symbol-completion';
import { registerSnippetProviders } from '../snippets';
import { ensureLanguageRegistered } from '../textmate/registry';
import { lspSync, isLspPath } from '../lsp-sync';
import { SplitPane } from './SplitPane';
import { ImageView, isImagePath } from './ImageView';
import { DiffView } from './DiffView';
import { DirCompareView } from './DirCompareView';

/** 에이전트 변경 제안 diff 탭 키 (가상 문서 — 파일 로드/저장/LSP 대상 아님) */
export const isDiffTabPath = (p: string): boolean => p.startsWith('diff://');
export const isDirCompareTabPath = (p: string): boolean => p.startsWith('dircmp://');

let editorInstance: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;

const uriOf = (relPath: string) => monaco.Uri.file('/' + relPath);
export const editorUriOf = uriOf; // SplitPane 등 외부에서 모델 조회용

export function revealLine(line: number): void {
  editorInstance?.revealLineInCenter(line);
  editorInstance?.setPosition({ lineNumber: line, column: 1 });
  editorInstance?.focus();
}

export function getContent(relPath: string): string | null {
  return monaco.editor.getModel(uriOf(relPath))?.getValue() ?? null;
}

export function setDiskContent(relPath: string, content: string): void {
  const model = monaco.editor.getModel(uriOf(relPath));
  if (model && model.getValue() !== content) model.setValue(content);
}

export function disposeModel(relPath: string): void {
  lspSync.lspClose(relPath); // close ⇒ dispose 불변식: 탭 닫기/삭제 파일 정리 시 didClose 통지
  monaco.editor.getModel(uriOf(relPath))?.dispose();
}

export function disposeAllModels(): void {
  lspSync.lspCloseAll(); // 프로젝트 전환 — 열린 모든 LSP 문서 didClose
  for (const model of monaco.editor.getModels()) model.dispose();
}

/** 현재 커서 위치(1-based). 내비게이션 히스토리 push 및 F12 정의 점프의 기준점. */
export function getCursorLocation(): Loc | null {
  const st = useAppStore.getState();
  const pos = editorInstance?.getPosition();
  if (!st.activePath || !pos) return null;
  return { path: st.activePath, line: pos.lineNumber, col: pos.column };
}

/** 채팅 컨텍스트용 에디터 상태 (1-기반 줄). 에디터/활성 파일 없으면 null. */
export function getChatEditorState(): import('../chat-context').ChatEditorState | null {
  const st = useAppStore.getState();
  const model = editorInstance?.getModel();
  const pos = editorInstance?.getPosition();
  if (!st.activePath || !model || !pos || !editorInstance) return null;
  const sel = editorInstance.getSelection();
  const selectionText = sel && !sel.isEmpty() ? model.getValueInRange(sel) : null;
  return {
    path: st.activePath,
    languageId: model.getLanguageId(),
    selectionText,
    selectionStartLine: sel && selectionText ? sel.startLineNumber : 0,
    cursorLine: pos.lineNumber,
    lines: model.getLinesContent(),
  };
}

/** 현재 에디터 선택 텍스트. 선택 없음/에디터·모델 없음이면 null. (전체 검색 시드용) */
export function getSelectedText(): string | null {
  const model = editorInstance?.getModel();
  const sel = editorInstance?.getSelection();
  if (!model || !sel || sel.isEmpty()) return null;
  return model.getValueInRange(sel);
}

let refDecorations: import('monaco-editor').editor.IEditorDecorationsCollection | null = null;

/** 파일 내 whole-word 일치를 하이라이트 (스펙 §6 자동 참조 하이라이트의 텍스트 기반 구현). */
function highlightReferences(model: import('monaco-editor').editor.ITextModel, word: string | null): void {
  if (!editorInstance) return;
  refDecorations?.clear();
  if (!word) return;
  const matches = model.findMatches(word, false, false, true /* wholeWord */, null, false, 200);
  refDecorations = editorInstance.createDecorationsCollection(
    matches.map((m) => ({ range: m.range, options: { className: 'ref-highlight' } })),
  );
}

function clearReferenceHighlights(): void {
  refDecorations?.clear();
  refDecorations = null;
}

// 시맨틱 토큰(글자색) — 참조 하이라이트(배경색)와 독립된 별도 컬렉션.
let semDecorations: import('monaco-editor').editor.IEditorDecorationsCollection | null = null;

function clearSemanticTokens(): void {
  semDecorations?.clear();
  semDecorations = null;
}

// 리비전 마크(git gutter) — 디스크 기준 HEAD 대비 변경 라인 바
let revDecorations: import('monaco-editor').editor.IEditorDecorationsCollection | null = null;
function clearRevisionMarks(): void {
  revDecorations?.clear();
  revDecorations = null;
}

async function resolveAndJump(name: string, fromPath: string): Promise<void> {
  const cands = await window.si.resolve(name, fromPath).catch(() => []);
  if (cands.length === 0) {
    useAppStore.getState().setError(`정의를 찾을 수 없음: ${name}`);
    return;
  }
  useAppStore.getState().setError(null);
  // Candidate.line은 0-based(tree-sitter row) → jumpTo/에디터는 1-based
  jumpTo(cands[0].path, cands[0].line + 1);
}

/** pendingJump가 현재 활성 모델과 일치하면 이동 후 소비. 모델 로드 전이면 no-op(재트리거됨). */
function applyPendingJump(): void {
  const st = useAppStore.getState();
  const pj = st.pendingJump;
  if (!pj || pj.path !== st.activePath || !editorInstance) return;
  const model = monaco.editor.getModel(uriOf(pj.path));
  if (!model || editorInstance.getModel() !== model) return;
  editorInstance.revealLineInCenter(pj.line);
  editorInstance.setPosition({ lineNumber: pj.line, column: pj.col });
  editorInstance.focus();
  st.setPendingJump(null);
}

const bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleBufferIndex(relPath: string, model: import('monaco-editor').editor.ITextModel): void {
  const prev = bufferTimers.get(relPath);
  if (prev) clearTimeout(prev);
  bufferTimers.set(
    relPath,
    setTimeout(() => {
      bufferTimers.delete(relPath);
      if (model.isDisposed()) return;
      void window.si.indexBuffer(relPath, model.getValue()).catch(() => {});
    }, 500),
  );
}

let cursorTimer: ReturnType<typeof setTimeout> | null = null;

export function EditorPane() {
  const activePath = useAppStore((s) => s.activePath);
  const pendingJump = useAppStore((s) => s.pendingJump);
  const outlineVersion = useAppStore((s) => s.outlineVersion);
  const indexing = useAppStore((s) => s.indexing);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    editorInstance = monaco.editor.create(hostRef.current!, {
      automaticLayout: true,
      minimap: { enabled: true },
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }, // 얇은 스크롤바 (전역 톤 통일)
      inlineSuggest: { enabled: true }, // AI 고스트 텍스트 활성화
      // 단어 기반 자동완성 팝업이 열려 있는 동안 Monaco가 고스트 텍스트를 억제하므로
      // 자동 팝업을 끈다 (Ctrl+Space 수동 호출은 유지) — AI 완성이 주 UX
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      model: null,
    });
    registerCompletionProvider(monaco); // 앱 수명 1회 (내부 플래그로 재마운트 이중 등록 방지)
    registerLspFeatures(monaco); // 앱 수명 1회 (내부 플래그)
    registerSymbolCompletion(monaco); // 비-LSP 언어(c/cpp/java) 인덱서 심볼 완성 — 앱 수명 1회
    registerSnippetProviders(monaco); // 앱 수명 1회 (내부 플래그) — 스니펫 완성 제공자
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      window.dispatchEvent(new CustomEvent('si:save')),
    );
    setCurrentLocProvider(getCursorLocation);

    // 커서 이동 150ms 디바운스 → cursorSymbol 갱신 + 참조 하이라이트
    editorInstance.onDidChangeCursorPosition((e) => {
      if (cursorTimer) clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => {
        const st = useAppStore.getState();
        const model = editorInstance?.getModel();
        if (!model || !st.activePath) return;
        const word = model.getWordAtPosition(e.position);
        const prev = st.cursorSymbol;
        const next = word
          ? { name: word.word, path: st.activePath, line: e.position.lineNumber, col: e.position.column }
          : null;
        // 같은 심볼(name/path 동일)이면 새 객체를 만들지 않는다 — cursorSymbol 정체성 변화로 인한
        // Relation/Context 재실행(수동 트리 확장 폐기)을 방지 (position 필드는 resolve 입력이 아님)
        if (!(prev?.name === next?.name && prev?.path === next?.path && (prev === null) === (next === null))) {
          st.setCursorSymbol(next);
        }
        highlightReferences(model, word?.word ?? null);
      }, 150);
    });

    // Ctrl/Cmd+클릭 → 정의 점프
    editorInstance.onMouseDown((e) => {
      if (!(e.event.ctrlKey || e.event.metaKey)) return;
      const pos = e.target.position;
      const model = editorInstance?.getModel();
      const st = useAppStore.getState();
      if (!pos || !model || !st.activePath) return;
      const word = model.getWordAtPosition(pos);
      if (word) {
        const activePath = st.activePath;
        void (async () => {
          const jumped = await tryLspDefinition(activePath, pos.lineNumber, word.startColumn);
          if (!jumped) void resolveAndJump(word.word, activePath);
        })();
      }
    });

    // F12 → 정의 점프
    editorInstance.addCommand(monaco.KeyCode.F12, () => {
      const loc = getCursorLocation();
      const model = editorInstance?.getModel();
      if (!loc || !model) return;
      const word = model.getWordAtPosition({ lineNumber: loc.line, column: loc.col });
      if (word) {
        void (async () => {
          const jumped = await tryLspDefinition(loc.path, loc.line, word.startColumn);
          if (!jumped) void resolveAndJump(word.word, loc.path);
        })();
      }
    });

    // F2 → Smart Rename 오버레이 열기 (커서 단어 기준)
    editorInstance.addCommand(monaco.KeyCode.F2, () => {
      const loc = getCursorLocation();
      const model = editorInstance?.getModel();
      if (!loc || !model) return;
      const word = model.getWordAtPosition({ lineNumber: loc.line, column: loc.col });
      if (word) useAppStore.getState().setRenameRequest({ name: word.word, path: loc.path, line: loc.line, col: word.startColumn });
    });

    return () => {
      if (cursorTimer) {
        clearTimeout(cursorTimer);
        cursorTimer = null;
      }
      setCurrentLocProvider(() => null);
      editorInstance?.dispose();
      editorInstance = null;
    };
  }, []);

  useEffect(() => {
    // 모델 교체 — 이전 파일의 참조 하이라이트 잔존 방지
    clearReferenceHighlights();
    if (!activePath) {
      editorInstance?.setModel(null);
      return;
    }
    // 이미지/diff/dircmp 탭 — 텍스트 모델을 만들지 않는다 (전용 뷰가 표시, Monaco는 CSS 숨김)
    if (isImagePath(activePath) || isDiffTabPath(activePath) || isDirCompareTabPath(activePath)) {
      editorInstance?.setModel(null);
      return;
    }
    const uri = uriOf(activePath);
    const existing = monaco.editor.getModel(uri);
    if (existing) {
      editorInstance?.setModel(existing);
      // 이미 열린 탭으로 전환 시에도 LSP 언어에서만 자동 제안 유지 (스펙 §5)
      const lspLang = isLspPath(activePath);
      editorInstance?.updateOptions({ quickSuggestions: lspLang, suggestOnTriggerCharacters: lspLang });
      applyPendingJump();
      return;
    }
    let cancelled = false;
    void window.si
      .readFile(activePath)
      .then((content) => {
        if (cancelled) return;
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, undefined, uri);
        // TextMate 문법 지연 등록 (비동기 — 실패해도 monarch 유지, await 불요)
        void ensureLanguageRegistered(monaco, model.getLanguageId());
        lspSync.lspOpen(activePath, model.getValue());
        // LSP 언어만 자동 제안 활성 — 그 외 언어는 AI 고스트 주 UX 유지 (스펙 §5)
        const lspLang = isLspPath(activePath);
        editorInstance?.updateOptions({ quickSuggestions: lspLang, suggestOnTriggerCharacters: lspLang });
        model.onDidChangeContent((e) => {
          // setValue(디스크 리로드/setDiskContent)는 flush — 사용자 편집이 아니므로 dirty/버퍼인덱스 제외
          if (e.isFlush) return;
          useAppStore.getState().setDirty(activePath, true);
          scheduleBufferIndex(activePath, model); // 500ms 유휴 재파싱 (스펙 §8)
          lspSync.lspChange(activePath, model.getValue());
        });
        editorInstance?.setModel(model);
        applyPendingJump(); // 비동기 모델 로드 후 대기 중 점프 소비
      })
      .catch(() => {
        // 읽기 실패(삭제된 파일 등) → 모델 폐기 후 탭 닫기 ("close ⇒ dispose" 불변식 유지)
        disposeModel(activePath);
        useAppStore.getState().closeTab(activePath);
      });
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  // 시맨틱 토큰 색칠 — 심볼 DB 기반. 파일 전환/재인덱싱(outlineVersion) 시 재적용.
  useEffect(() => {
    clearSemanticTokens();
    if (!activePath || indexing || isImagePath(activePath) || isDiffTabPath(activePath) || isDirCompareTabPath(activePath)) return; // 인덱싱 중/비활성/이미지/diff/dircmp 탭 → 색칠 없음(무해)
    let cancelled = false;
    const uri = uriOf(activePath);
    const apply = (attempt = 0): void => {
      if (cancelled) return;
      const model = monaco.editor.getModel(uri);
      // 모델이 아직 로드/활성화되지 않았으면 잠시 후 재시도 (파일 첫 열림 레이스)
      if (!model || editorInstance?.getModel() !== model) {
        if (attempt < 20) setTimeout(() => apply(attempt + 1), 100);
        return;
      }
      void window.si
        .getFileTokens(activePath)
        .then((tokens) => {
          if (cancelled || !editorInstance || editorInstance.getModel() !== model) return;
          const decos = buildTokenDecorations(tokens.symbols, tokens.refs);
          semDecorations?.clear();
          semDecorations = editorInstance.createDecorationsCollection(
            decos.map((d) => ({
              range: new monaco.Range(d.line + 1, d.col + 1, d.line + 1, d.col + 1 + d.length),
              options: { inlineClassName: d.className },
            })),
          );
        })
        .catch(() => {}); // 인덱서 미기동/비지원 파일 등 — 조용히 무시
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [activePath, outlineVersion, indexing]);

  // 리비전 마크 — git HEAD 대비 변경 라인 gutter 바. 파일 전환/저장·재인덱싱(outlineVersion) 시 갱신.
  useEffect(() => {
    clearRevisionMarks();
    if (!activePath || isImagePath(activePath) || isDiffTabPath(activePath) || isDirCompareTabPath(activePath)) return;
    let cancelled = false;
    const uri = uriOf(activePath);
    const apply = (attempt = 0): void => {
      if (cancelled) return;
      const model = monaco.editor.getModel(uri);
      if (!model || editorInstance?.getModel() !== model) {
        if (attempt < 20) setTimeout(() => apply(attempt + 1), 100);
        return;
      }
      void window.si
        .gitFileDiff(activePath)
        .then((ranges) => {
          if (cancelled || !editorInstance || editorInstance.getModel() !== model) return;
          revDecorations?.clear();
          revDecorations = editorInstance.createDecorationsCollection(
            ranges.map((r) => ({
              range: new monaco.Range(r.startLine, 1, r.endLine, 1),
              options: { linesDecorationsClassName: `rev-mark rev-mark-${r.type}` },
            })),
          );
        })
        .catch(() => {}); // 비-git/오류 — 조용히 무시
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [activePath, outlineVersion]);

  // pendingJump 소비 — activePath 모델 세팅 이후 반영 (모델 로드 전이면 위 effect가 재시도)
  useEffect(() => {
    if (!pendingJump || pendingJump.path !== activePath) return;
    applyPendingJump();
  }, [pendingJump, activePath]);

  const showImage = !!activePath && isImagePath(activePath);
  const activeTab = useAppStore((s) => (s.activePath ? s.tabs.find((t) => t.path === s.activePath) : undefined));
  const activeDiff = activeTab?.diff;
  const activeDirCompare = activeTab?.dirCompare;
  const hideEditor = showImage || !!activeDiff || !!activeDirCompare;
  return (
    <div className="editor-split-row">
      <div ref={hostRef} className="editor-host" style={hideEditor ? { display: 'none' } : undefined} />
      {showImage && <ImageView path={activePath} />}
      {activeDiff && <DiffView path={activeDiff.path} before={activeDiff.before} after={activeDiff.after} />}
      {activeDirCompare && <DirCompareView leftDir={activeDirCompare.leftDir} rightDir={activeDirCompare.rightDir} entries={activeDirCompare.entries} />}
      <SplitPane />
    </div>
  );
}
