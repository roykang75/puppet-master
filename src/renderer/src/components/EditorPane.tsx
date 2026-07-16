import { useEffect, useRef } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { jumpTo, setCurrentLocProvider, type Loc } from '../navigation';

let editorInstance: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;

const uriOf = (relPath: string) => monaco.Uri.file('/' + relPath);

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
  monaco.editor.getModel(uriOf(relPath))?.dispose();
}

export function disposeAllModels(): void {
  for (const model of monaco.editor.getModels()) model.dispose();
}

/** 현재 커서 위치(1-based). 내비게이션 히스토리 push 및 F12 정의 점프의 기준점. */
export function getCursorLocation(): Loc | null {
  const st = useAppStore.getState();
  const pos = editorInstance?.getPosition();
  if (!st.activePath || !pos) return null;
  return { path: st.activePath, line: pos.lineNumber, col: pos.column };
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

/** 텍스트 검색 결과 점프: 파일 열고 첫 일치 위치로 이동 (FTS는 줄 정보가 없음) */
export function findFirstAndReveal(path: string, query: string): void {
  jumpTo(path, 1);
  // 모델 로드 후 첫 일치 탐색 — pendingJump 소비 시점에 이어서 실행되도록 지연 재시도
  const tryFind = (attempt = 0): void => {
    const model = monaco.editor.getModel(uriOf(path));
    // 모델 미생성 또는 아직 에디터에 활성화되지 않음 — 둘 다 재시도 대상
    if (!model || editorInstance?.getModel() !== model) {
      if (attempt < 20) setTimeout(() => tryFind(attempt + 1), 100);
      return;
    }
    const m = model.findMatches(query, false, false, false, null, false, 1)[0];
    if (m) {
      editorInstance.revealLineInCenter(m.range.startLineNumber);
      editorInstance.setPosition({ lineNumber: m.range.startLineNumber, column: m.range.startColumn });
    }
  };
  tryFind();
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
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    editorInstance = monaco.editor.create(hostRef.current!, {
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      model: null,
    });
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
      if (word) void resolveAndJump(word.word, st.activePath);
    });

    // F12 → 정의 점프
    editorInstance.addCommand(monaco.KeyCode.F12, () => {
      const loc = getCursorLocation();
      const model = editorInstance?.getModel();
      if (!loc || !model) return;
      const word = model.getWordAtPosition({ lineNumber: loc.line, column: loc.col });
      if (word) void resolveAndJump(word.word, loc.path);
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
    const uri = uriOf(activePath);
    const existing = monaco.editor.getModel(uri);
    if (existing) {
      editorInstance?.setModel(existing);
      applyPendingJump();
      return;
    }
    let cancelled = false;
    void window.si
      .readFile(activePath)
      .then((content) => {
        if (cancelled) return;
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, undefined, uri);
        model.onDidChangeContent(() => {
          useAppStore.getState().setDirty(activePath, true);
          scheduleBufferIndex(activePath, model); // 500ms 유휴 재파싱 (스펙 §8)
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

  // pendingJump 소비 — activePath 모델 세팅 이후 반영 (모델 로드 전이면 위 effect가 재시도)
  useEffect(() => {
    if (!pendingJump || pendingJump.path !== activePath) return;
    applyPendingJump();
  }, [pendingJump, activePath]);

  return <div ref={hostRef} className="editor-host" />;
}
