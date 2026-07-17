import { useEffect, useRef, useState } from 'react';
import { VscChevronDown, VscChevronRight, VscNewFile, VscNewFolder, VscRefresh } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { fileIconUrl, folderIconUrl } from '../file-icons';

interface DirEntry {
  name: string;
  isDir: boolean;
}

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

export function ProjectWindow() {
  const root = useAppStore((s) => s.root);
  const openTab = useAppStore((s) => s.openTab);
  const [dirs, setDirs] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ rel: string; isDir: boolean } | null>(null);
  // VS Code 스타일 인라인 생성 — 대상 폴더의 자식 목록 맨 위에 이름 입력 행을 띄운다
  // anchor: 파일을 선택한 채 생성하면 그 파일 바로 아래에 입력 행을 붙인다 (VS Code 동작)
  const [creating, setCreating] = useState<{ kind: 'file' | 'dir'; dir: string; anchor: string | null } | null>(null);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDirs({});
    setExpanded(new Set());
    setSelected(null);
    setCreating(null);
    if (root) void window.si.listDir('').then((es) => setDirs({ '': es }));
  }, [root]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const loadDir = (rel: string) => {
    if (!dirs[rel]) void window.si.listDir(rel).then((es) => setDirs((d) => ({ ...d, [rel]: es })));
  };

  const toggle = (rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    loadDir(rel);
  };

  /** 루트 + 펼쳐진 폴더 전부 다시 읽기 (사라진 폴더는 접힘 처리) */
  const refresh = async (extraExpand: string[] = []) => {
    const expandedNext = new Set(expanded);
    for (const rel of extraExpand) if (rel) expandedNext.add(rel);
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

  /** 선택된 폴더(파일이면 그 부모) 안에 이름 입력 행 열기 */
  const startCreate = (kind: 'file' | 'dir') => {
    const dir = selected ? (selected.isDir ? selected.rel : parentOf(selected.rel)) : '';
    if (dir) {
      setExpanded((prev) => new Set(prev).add(dir));
      loadDir(dir);
    }
    setCreating({ kind, dir, anchor: selected && !selected.isDir ? selected.rel : null });
    setCreateName('');
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (!creating) return;
    const name = createName.trim().replace(/^\/+|\/+$/g, '');
    if (!name) return;
    const rel = creating.dir ? `${creating.dir}/${name}` : name;
    try {
      const r = creating.kind === 'file' ? await window.si.createFile(rel) : await window.si.createDir(rel);
      if (r) {
        setCreateError(r.error);
        return;
      }
      // 새 항목이 보이도록 조상 폴더(이름에 /를 쓴 경우 포함)를 모두 펼친 뒤 새로고침
      const parents: string[] = [];
      const parts = rel.split('/');
      const upto = parts.length + (creating.kind === 'dir' ? 1 : 0);
      for (let i = 1; i < upto; i++) parents.push(parts.slice(0, i).join('/'));
      await refresh(parents);
      if (creating.kind === 'file') openTab(rel);
      setSelected({ rel, isDir: creating.kind === 'dir' });
      setCreating(null);
    } catch (err) {
      // IPC 실패(구버전 main 실행 중 등)도 인라인으로 표시
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const createRow = (depth: number) => (
    <div key="__create__">
      <div className="tree-item create-item" style={{ paddingLeft: depth * 14 + 8 + 16 }}>
        <img
          className="file-icon"
          src={creating!.kind === 'dir' ? folderIconUrl(createName, false) : fileIconUrl(createName || 'file')}
          alt=""
        />
        <input
          ref={inputRef}
          className="create-name"
          value={createName}
          placeholder={creating!.kind === 'file' ? '파일 이름' : '폴더 이름'}
          onChange={(e) => {
            setCreateName(e.target.value);
            setCreateError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitCreate();
            if (e.key === 'Escape') setCreating(null);
          }}
          onBlur={() => setCreating(null)}
        />
      </div>
      {createError && (
        <div className="create-error" style={{ paddingLeft: depth * 14 + 8 + 16 }}>{createError}</div>
      )}
    </div>
  );

  const renderDir = (rel: string, depth: number): React.ReactNode => (
    <>
      {creating && creating.dir === rel && !creating.anchor && createRow(depth)}
      {(dirs[rel] ?? []).map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        return (
          <div key={childRel}>
            <div
              className={`tree-item${selected?.rel === childRel ? ' selected' : ''}`}
              style={{ paddingLeft: depth * 14 + 8 }}
              onClick={() => {
                setSelected({ rel: childRel, isDir: e.isDir });
                if (e.isDir) toggle(childRel);
                else openTab(childRel);
              }}
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
            {creating && creating.dir === rel && creating.anchor === childRel && createRow(depth)}
            {e.isDir && expanded.has(childRel) && renderDir(childRel, depth + 1)}
          </div>
        );
      })}
    </>
  );

  return (
    <div className="panel">
      <div className="panel-title panel-title-row">
        <span>Project</span>
        <span className="panel-title-actions">
          <button
            className="panel-action"
            title="새 파일"
            onMouseDown={(e) => e.preventDefault() /* 입력란 blur로 닫히기 전에 클릭 처리 */}
            onClick={() => startCreate('file')}
          ><VscNewFile /></button>
          <button
            className="panel-action"
            title="새 폴더"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => startCreate('dir')}
          ><VscNewFolder /></button>
          <button className="panel-action" title="새로고침" onClick={() => void refresh()}><VscRefresh /></button>
        </span>
      </div>
      <div className="panel-body">{renderDir('', 0)}</div>
    </div>
  );
}
