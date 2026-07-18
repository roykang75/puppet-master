import { useEffect, useRef, useState } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { MarkdownView } from './MarkdownView';
import { editorUriOf } from './EditorPane';

/** 세로 분할 창 — kind 'editor'는 같은 모델을 공유하는 두 번째 Monaco(양방향 실시간 동기화),
 * kind 'preview'는 마크다운 렌더 (편집 내용 300ms 디바운스 반영).
 * 에이전트 변경 제안 diff는 일반 탭(DiffView)으로 통합됨. */
export function SplitPane() {
  const split = useAppStore((s) => s.split);
  const hostRef = useRef<HTMLDivElement>(null);
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

  if (!split) return null;

  return (
    <div className="split-pane">
      {split.kind === 'editor' ? (
        <div ref={hostRef} className="split-body" />
      ) : (
        <div className="split-body split-preview"><MarkdownView content={content} /></div>
      )}
    </div>
  );
}
