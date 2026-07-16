import { useEffect, useRef } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';

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

export function EditorPane() {
  const activePath = useAppStore((s) => s.activePath);
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
    return () => {
      editorInstance?.dispose();
      editorInstance = null;
    };
  }, []);

  useEffect(() => {
    if (!activePath) {
      editorInstance?.setModel(null);
      return;
    }
    const uri = uriOf(activePath);
    const existing = monaco.editor.getModel(uri);
    if (existing) {
      editorInstance?.setModel(existing);
      return;
    }
    let cancelled = false;
    void window.si
      .readFile(activePath)
      .then((content) => {
        if (cancelled) return;
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, undefined, uri);
        model.onDidChangeContent(() => useAppStore.getState().setDirty(activePath, true));
        editorInstance?.setModel(model);
      })
      .catch(() => useAppStore.getState().closeTab(activePath)); // 읽기 실패(삭제된 파일 등) → 탭 닫기
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  return <div ref={hostRef} className="editor-host" />;
}
