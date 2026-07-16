import { useEffect, useRef, useState } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { getContent } from './EditorPane';
import { jumpTo } from '../navigation';
import type { Candidate } from '../../../indexer/resolve';

const MAX_PREVIEW_LINES = 80;

export function ContextPanel() {
  const cursorSymbol = useAppStore((s) => s.cursorSymbol);
  const outlineVersion = useAppStore((s) => s.outlineVersion);
  const indexing = useAppStore((s) => s.indexing);
  const [header, setHeader] = useState<{ label: string; path: string; line: number } | null>(null);
  const [hint, setHint] = useState<string>('심볼 위에 커서를 두면 정의를 표시합니다');
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    editorRef.current = monaco.editor.create(hostRef.current!, {
      theme: 'vs-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      model: null,
    });
    return () => {
      editorRef.current?.getModel()?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (indexing) {
      setHeader(null);
      setHint('인덱싱 중…');
      return;
    }
    if (!cursorSymbol) {
      setHeader(null);
      setHint('심볼 위에 커서를 두면 정의를 표시합니다');
      return;
    }
    let cancelled = false;
    void (async () => {
      const cands: Candidate[] = await window.si.resolve(cursorSymbol.name, cursorSymbol.path).catch(() => []);
      if (cancelled) return;
      if (cands.length === 0) {
        setHeader(null);
        setHint(`정의를 찾을 수 없음: ${cursorSymbol.name}`);
        return;
      }
      const top = cands[0];
      // 열린 모델이 있으면 그 내용(미저장 편집 반영), 없으면 디스크
      const content = getContent(top.path) ?? (await window.si.readFile(top.path).catch(() => null));
      if (cancelled || content == null) return;
      const lines = content.split('\n');
      const start = Math.max(0, top.line - 1); // top.line은 0-기반 start_line (Plan 1 규약)
      const slice = lines.slice(start, start + MAX_PREVIEW_LINES).join('\n');
      const ext = top.path.split('.').pop() ?? 'txt';
      const uri = monaco.Uri.parse(`si-preview:///preview.${ext}`);
      const prev = editorRef.current?.getModel();
      monaco.editor.getModel(uri)?.dispose(); // 동일 URI(같은 확장자) 재사용 시 중복 생성 방지
      const model = monaco.editor.createModel(slice, undefined, uri);
      editorRef.current?.setModel(model);
      if (prev && !prev.isDisposed()) prev.dispose(); // 이전 미리보기(다른 확장자 포함) 모델 누수 방지
      setHeader({
        label: `${top.name} — ${top.path}:${top.line + 1}${cands.length > 1 ? ` (후보 ${cands.length}개)` : ''}`,
        path: top.path,
        line: top.line + 1,
      });
      setHint('');
    })();
    return () => {
      cancelled = true;
    };
  }, [cursorSymbol, outlineVersion, indexing]);

  return (
    <div className="panel">
      <div className="panel-title">
        Context
        {header && (
          <span className="context-header" onClick={() => jumpTo(header.path, header.line)}>
            {header.label}
          </span>
        )}
      </div>
      <div className="panel-body context-body">
        {hint && <div className="hint">{hint}</div>}
        <div ref={hostRef} className="context-editor" style={{ display: hint ? 'none' : 'block' }} />
      </div>
    </div>
  );
}
