import { useEffect, useRef, useState } from 'react';
import { VscChevronDown, VscChevronRight, VscNewFile, VscNewFolder, VscRefresh } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { fileIconUrl, folderIconUrl } from '../file-icons';

interface DirEntry {
  name: string;
  isDir: boolean;
}

export function ProjectWindow() {
  const root = useAppStore((s) => s.root);
  const openTab = useAppStore((s) => s.openTab);
  const [dirs, setDirs] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null);
  const [createPath, setCreatePath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDirs({});
    setExpanded(new Set());
    if (root) void window.si.listDir('').then((es) => setDirs({ '': es }));
  }, [root]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const toggle = (rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    if (!dirs[rel]) void window.si.listDir(rel).then((es) => setDirs((d) => ({ ...d, [rel]: es })));
  };

  /** 루트 + 펼쳐진 폴더 전부 다시 읽기 (사라진 폴더는 접힘 처리) */
  const refresh = async (extraExpand: string[] = []) => {
    const expandedNext = new Set(expanded);
    for (const rel of extraExpand) expandedNext.add(rel);
    const next: Record<string, DirEntry[]> = {};
    for (const rel of ['', ...expandedNext]) {
      try {
        next[rel] = await window.si.listDir(rel);
      } catch {
        expandedNext.delete(rel);
      }
    }
    setDirs(next);
    setExpanded(expandedNext);
  };

  const startCreate = (kind: 'file' | 'dir') => {
    setCreating(kind);
    setCreatePath('');
    setCreateError(null);
  };

  const submitCreate = async () => {
    const rel = createPath.trim().replace(/^\/+|\/+$/g, '');
    if (!rel || !creating) return;
    const r = creating === 'file' ? await window.si.createFile(rel) : await window.si.createDir(rel);
    if (r) {
      setCreateError(r.error);
      return;
    }
    // 새 항목이 보이도록 조상 폴더를 모두 펼친 뒤 새로고침
    const parents: string[] = [];
    const parts = rel.split('/');
    for (let i = 1; i < parts.length + (creating === 'dir' ? 1 : 0); i++) parents.push(parts.slice(0, i).join('/'));
    await refresh(parents);
    if (creating === 'file') openTab(rel);
    setCreating(null);
  };

  const renderDir = (rel: string, depth: number): React.ReactNode =>
    (dirs[rel] ?? []).map((e) => {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      return (
        <div key={childRel}>
          <div
            className="tree-item"
            style={{ paddingLeft: depth * 14 + 8 }}
            onClick={() => (e.isDir ? toggle(childRel) : openTab(childRel))}
          >
            <span className="tree-icon">
              {e.isDir && (expanded.has(childRel) ? <VscChevronDown /> : <VscChevronRight />)}
            </span>
            <img
              className="file-icon"
              src={e.isDir ? folderIconUrl(e.name, expanded.has(childRel)) : fileIconUrl(e.name)}
              alt=""
            />
            {e.name}
          </div>
          {e.isDir && expanded.has(childRel) && renderDir(childRel, depth + 1)}
        </div>
      );
    });

  return (
    <div className="panel">
      <div className="panel-title panel-title-row">
        <span>Project</span>
        <span className="panel-title-actions">
          <button className="panel-action" title="새 파일" onClick={() => startCreate('file')}><VscNewFile /></button>
          <button className="panel-action" title="새 폴더" onClick={() => startCreate('dir')}><VscNewFolder /></button>
          <button className="panel-action" title="새로고침" onClick={() => void refresh()}><VscRefresh /></button>
        </span>
      </div>
      {creating && (
        <div className="create-row">
          <input
            ref={inputRef}
            value={createPath}
            placeholder={creating === 'file' ? '파일 경로 (예: src/new.ts)' : '폴더 경로 (예: src/utils)'}
            onChange={(e) => {
              setCreatePath(e.target.value);
              setCreateError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitCreate();
              if (e.key === 'Escape') setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
          {createError && <div className="create-error">{createError}</div>}
        </div>
      )}
      <div className="panel-body">{renderDir('', 0)}</div>
    </div>
  );
}
