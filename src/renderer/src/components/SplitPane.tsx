import { useEffect, useRef, useState } from 'react';
import { VscClose, VscOpenPreview } from 'react-icons/vsc';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { fileIconUrl } from '../file-icons';
import { MarkdownView } from './MarkdownView';
import { editorUriOf } from './EditorPane';

/** 세로 분할 창 — kind 'editor'는 같은 모델을 공유하는 두 번째 Monaco(양방향 실시간 동기화),
 * kind 'preview'는 마크다운 렌더 (편집 내용 300ms 디바운스 반영) */
export function SplitPane() {
  const split = useAppStore((s) => s.split);
  const setSplit = useAppStore((s) => s.setSplit);
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
  const name = split.path.split('/').pop() ?? split.path;

  return (
    <div className="split-pane">
      <div className="split-header">
        <div className="split-tab">
          {split.kind === 'preview' ? (
            <span className="split-tab-icon"><VscOpenPreview /></span>
          ) : (
            <img className="file-icon tab-file-icon" src={fileIconUrl(name)} alt="" />
          )}
          <span className="split-title">{split.kind === 'preview' ? `미리보기 ${name}` : name}</span>
          <span className="tab-close" title="분할 닫기" onClick={() => setSplit(null)}><VscClose /></span>
        </div>
      </div>
      {split.kind === 'editor' ? (
        <div ref={hostRef} className="split-body" />
      ) : (
        <div className="split-body split-preview"><MarkdownView content={content} /></div>
      )}
    </div>
  );
}
