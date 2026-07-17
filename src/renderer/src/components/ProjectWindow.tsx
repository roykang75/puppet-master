import { useEffect, useState } from 'react';
import { VscChevronDown, VscChevronRight, VscFile } from 'react-icons/vsc';
import { useAppStore } from '../store';

interface DirEntry {
  name: string;
  isDir: boolean;
}

export function ProjectWindow() {
  const root = useAppStore((s) => s.root);
  const openTab = useAppStore((s) => s.openTab);
  const [dirs, setDirs] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDirs({});
    setExpanded(new Set());
    if (root) void window.si.listDir('').then((es) => setDirs({ '': es }));
  }, [root]);

  const toggle = (rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    if (!dirs[rel]) void window.si.listDir(rel).then((es) => setDirs((d) => ({ ...d, [rel]: es })));
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
              {e.isDir ? (expanded.has(childRel) ? <VscChevronDown /> : <VscChevronRight />) : <VscFile />}
            </span>
            {e.name}
          </div>
          {e.isDir && expanded.has(childRel) && renderDir(childRel, depth + 1)}
        </div>
      );
    });

  return (
    <div className="panel">
      <div className="panel-title">Project</div>
      <div className="panel-body">{renderDir('', 0)}</div>
    </div>
  );
}
