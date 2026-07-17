import { useEffect, useRef, useState } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { MarkdownView } from './MarkdownView';
import { editorUriOf } from './EditorPane';

/** 세로 분할 창 — kind 'editor'는 같은 모델을 공유하는 두 번째 Monaco(양방향 실시간 동기화),
 * kind 'preview'는 마크다운 렌더 (편집 내용 300ms 디바운스 반영),
 * kind 'diff'는 에이전트 write_file의 원본 vs 제안 (Monaco DiffEditor, 읽기 전용) */
export function SplitPane() {
  const split = useAppStore((s) => s.split);
  const hostRef = useRef<HTMLDivElement>(null);
  const diffHostRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState('');

  // 분할 에디터 — 활성 파일과 같은 텍스트 모델 공유
  useEffect(() => {
    if (!split || split.kind !== 'editor' || !hostRef.current) return;
    const model = monaco.editor.getModel(editorUriOf(split.path));
    if (!model) return;
    const ed = monaco.editor.create(hostRef.current, {
      automaticLayout: true,
      minimap: { enabled: false },
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      model,
    });
    return () => ed.dispose(); // 모델은 공유 자산 — dispose하지 않는다
  }, [split]);

  // 미리보기 — 모델 변경 300ms 디바운스로 재렌더
  useEffect(() => {
    if (!split || split.kind !== 'preview') return;
    const model = monaco.editor.getModel(editorUriOf(split.path));
    if (!model) return;
    setContent(model.getValue());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = model.onDidChangeContent(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setContent(model.getValue()), 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.dispose();
    };
  }, [split]);

  // 에이전트 diff 뷰 — 임시 인메모리 모델 2개 (파일 편집 모델과 URI 분리, 언마운트 시 폐기)
  useEffect(() => {
    if (!split || split.kind !== 'diff' || !diffHostRef.current) return;
    const original = monaco.editor.createModel(split.before, undefined, monaco.Uri.parse(`agent-diff://before/${split.path}`));
    const modified = monaco.editor.createModel(split.after, undefined, monaco.Uri.parse(`agent-diff://after/${split.path}`));
    const ed = monaco.editor.createDiffEditor(diffHostRef.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      renderSideBySideInlineBreakpoint: 600, // 좁으면 인라인 diff로 자동 전환
      // 미니맵 유지 — 그 위에 겹치는 오버레이는 전부 제거:
      minimap: { enabled: true, showSlider: 'mouseover' },
      renderOverviewRuler: false, // diff 마크 룰러 (미니맵이 diff를 이미 표시)
      overviewRulerLanes: 0, // 커서/선택 데코레이션 룰러 캔버스 — 미니맵 옆 어두운 세로 막대의 정체
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    });
    ed.setModel({ original, modified });
    return () => {
      ed.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [split]);

  if (!split) return null;

  return (
    <div className="split-pane">
      {split.kind === 'editor' ? (
        <div ref={hostRef} className="split-body" />
      ) : split.kind === 'diff' ? (
        <div ref={diffHostRef} className="split-body" />
      ) : (
        <div className="split-body split-preview"><MarkdownView content={content} /></div>
      )}
    </div>
  );
}
