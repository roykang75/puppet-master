import { useEffect, useRef, useState } from 'react';
import { VscChevronDown, VscChevronRight, VscCircleSmallFilled } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import type { Candidate } from '../../../indexer/resolve';
import type { SymbolHit, CallerHit, FileFlow } from '../../../indexer/api';

type Tab = 'calls' | 'callers' | 'refs' | 'class' | 'flow';

interface Node {
  key: string;           // `${name}:${path}:${line}` — visited/expand 키
  label: string;
  detail: string;        // path:line
  path: string;
  line: number;          // 1-기반
  name: string;
  symbolId: number | null;
  expandable: boolean;
  expanded: boolean;       // 펼침 상태 (children 폐기 없이 토글)
  children: Node[] | null; // null = 미로드
}

const keyOf = (name: string, path: string, line: number) => `${name}:${path}:${line}`;

function symToNode(s: SymbolHit): Node {
  return {
    key: keyOf(s.name, s.path, s.line), label: s.name, detail: `${s.path}:${s.line + 1}`,
    path: s.path, line: s.line + 1, name: s.name, symbolId: s.id, expandable: true, expanded: false, children: null,
  };
}

function callerToNode(c: CallerHit): Node {
  const nm = c.callerName ?? '(최상위)';
  return {
    key: keyOf(nm, c.path, c.line), label: nm, detail: `${c.path}:${c.line + 1}`,
    path: c.path, line: c.line + 1, name: nm, symbolId: c.callerId,
    expandable: c.callerName !== null, expanded: false, children: null,
  };
}

async function loadChildren(tab: Tab, node: Node, visited: Set<string>): Promise<Node[]> {
  let next: Node[] = [];
  if (tab === 'calls' && node.symbolId !== null) {
    next = (await window.si.getCallees(node.symbolId)).map(symToNode);
  } else if (tab === 'callers') {
    next = (await window.si.getCallers(node.name)).map(callerToNode);
  } else if (tab === 'class' && node.symbolId !== null) {
    const [supers, subs] = await Promise.all([
      window.si.getSuperclasses(node.symbolId),
      window.si.getSubclasses(node.name),
    ]);
    next = [
      ...supers.map((s) => ({ ...symToNode(s), label: `▲ ${s.name}` })),
      ...subs.map((s) => ({ ...symToNode(s), label: `▼ ${s.name}` })),
    ];
  }
  // 순환 가드: 이미 방문한 노드는 리프로
  return next.map((n) => (visited.has(n.key) ? { ...n, expandable: false } : n));
}

type Ref = { path: string; line: number; kind: string; enclosingName: string | null };

// path별 그룹 (첫 등장 순서 보존)
function groupByPath(refs: Ref[]): Array<[string, Ref[]]> {
  const groups = new Map<string, Ref[]>();
  for (const r of refs) {
    const g = groups.get(r.path);
    if (g) g.push(r);
    else groups.set(r.path, [r]);
  }
  return [...groups];
}

export function RelationPanel() {
  const cursorSymbol = useAppStore((s) => s.cursorSymbol);
  const outlineVersion = useAppStore((s) => s.outlineVersion);
  const indexing = useAppStore((s) => s.indexing);
  const activePath = useAppStore((s) => s.activePath);
  const [tab, setTab] = useState<Tab>('callers');
  const [root, setRoot] = useState<Candidate | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [flow, setFlow] = useState<FileFlow | null>(null);
  const [visited] = useState(() => new Set<string>());
  const genRef = useRef(0);

  // Flow 탭 — 활성 파일의 HTTP 경계(호출부↔엔드포인트) 단일 왕복. 커서 심볼과 무관.
  useEffect(() => {
    if (tab !== 'flow') return;
    setFlow(null);
    if (indexing || !activePath || activePath.includes('://')) return; // 인덱싱 중/diff·dircmp 가상 탭 제외
    let cancelled = false;
    void window.si.getFlowForFile(activePath)
      .then((f) => { if (!cancelled) setFlow(f); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tab, activePath, outlineVersion, indexing]);

  useEffect(() => {
    if (tab === 'flow') return; // flow는 위 전용 effect
    if (indexing || !cursorSymbol) { setRoot(null); setNodes([]); setRefs([]); return; }
    let cancelled = false;
    const gen = ++genRef.current;
    void (async () => {
      const cands = await window.si.resolve(cursorSymbol.name, cursorSymbol.path).catch(() => []);
      if (cancelled) return;
      const top = cands[0] ?? null;
      setRoot(top);
      visited.clear();
      if (!top) { setNodes([]); setRefs([]); return; }
      visited.add(keyOf(top.name, top.path, top.line));
      if (tab === 'refs') {
        const rs = await window.si.getReferences(top.name).catch(() => []);
        if (!cancelled) setRefs(rs.map((r) => ({ path: r.path, line: r.line + 1, kind: r.kind, enclosingName: r.enclosingName })));
      } else {
        const rootNode = symToNode(top);
        const children = await loadChildren(tab, rootNode, visited).catch(() => []);
        if (!cancelled) {
          children.forEach((c) => visited.add(c.key));
          setNodes(children);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [cursorSymbol, tab, outlineVersion, indexing]);

  const expand = async (node: Node) => {
    if (node.expanded) { node.expanded = false; setNodes((cur) => [...cur]); return; } // 접기
    if (node.children === null) {                                                       // 최초 펼침만 fetch
      const gen = genRef.current;
      const children = await loadChildren(tab, node, visited).catch(() => []);
      if (gen !== genRef.current) return;                                               // stale 응답 무시
      children.forEach((c) => visited.add(c.key));
      node.children = children;
    }
    node.expanded = true;
    setNodes((cur) => [...cur]);
  };

  const renderNodes = (ns: Node[], depth: number): React.ReactNode =>
    ns.map((n) => (
      <div key={n.key + depth}>
        <div className="rel-item" style={{ paddingLeft: depth * 14 + 8 }}>
          <span
            className="tree-icon"
            onClick={(e) => { e.stopPropagation(); if (n.expandable) void expand(n); }}
          >
            {n.expandable ? (n.expanded ? <VscChevronDown /> : <VscChevronRight />) : <VscCircleSmallFilled />}
          </span>
          <span className="rel-label" onClick={() => jumpTo(n.path, n.line)}>{n.label}</span>
          <span className="rel-detail">{n.detail}</span>
        </div>
        {n.expanded && n.children && renderNodes(n.children, depth + 1)}
      </div>
    ));

  const treeTitle = tab === 'flow'
    ? ' — Flow'
    : root
      ? ` — ${root.name}${tab !== 'refs' && nodes.length > 0 ? ` (${nodes.length})` : ''}`
      : '';

  return (
    <div className="panel">
      <div className="panel-title">Relation{treeTitle}</div>
      <div className="rel-tabs">
        {(['calls', 'callers', 'refs', 'class', 'flow'] as Tab[]).map((t) => (
          <span key={t} className={`rel-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {{ calls: 'Calls', callers: 'Callers', refs: 'Refs', class: 'Class', flow: 'Flow' }[t]}
          </span>
        ))}
      </div>
      <div className="panel-body">
        {indexing && <div className="hint">인덱싱 중…</div>}
        {!indexing && tab === 'flow' && (
          !activePath || activePath.includes('://') ? <div className="hint">파일을 여세요</div>
          : !flow ? <div className="hint">로딩…</div>
          : flow.calls.length === 0 && flow.endpoints.length === 0 ? <div className="hint">이 파일에 HTTP 경계 없음</div>
          : (
            <>
              {flow.calls.length > 0 && <div className="rel-group">HTTP 호출 ({flow.calls.length})</div>}
              {flow.calls.map((c) => (
                <div key={`c${c.id}`}>
                  <div className="rel-item" onClick={() => jumpTo(c.file, c.line + 1)}>
                    <span className="flow-method">{c.method}</span>
                    <span className="rel-label">{c.rawPath}</span>
                    {c.path === '' && <span className="flow-unresolved">unresolved</span>}
                    <span className="rel-detail">:{c.line + 1}</span>
                  </div>
                  {c.endpoints.map((e) => (
                    <div key={`ce${e.id}`} className="rel-item flow-target" style={{ paddingLeft: 24 }} onClick={() => jumpTo(e.file, e.line + 1)}>
                      <span className="rel-label">→ {e.handlerName ?? e.path}</span>
                      <span className="rel-detail">{e.file}:{e.line + 1}</span>
                    </div>
                  ))}
                  {c.path !== '' && c.endpoints.length === 0 && (
                    <div className="hint" style={{ paddingLeft: 24 }}>매칭되는 엔드포인트 없음</div>
                  )}
                </div>
              ))}
              {flow.endpoints.length > 0 && <div className="rel-group">엔드포인트 ({flow.endpoints.length})</div>}
              {flow.endpoints.map((e) => (
                <div key={`e${e.id}`}>
                  <div className="rel-item" onClick={() => jumpTo(e.file, e.line + 1)}>
                    <span className="flow-method">{e.method}</span>
                    <span className="rel-label">{e.path}{e.handlerName ? ` (${e.handlerName})` : ''}</span>
                    <span className="rel-detail">:{e.line + 1}</span>
                  </div>
                  {e.calls.map((c) => (
                    <div key={`ec${c.id}`} className="rel-item flow-target" style={{ paddingLeft: 24 }} onClick={() => jumpTo(c.file, c.line + 1)}>
                      <span className="rel-label">← {c.enclosingName ?? '(파일)'}</span>
                      <span className="rel-detail">{c.file}:{c.line + 1}</span>
                    </div>
                  ))}
                  {e.calls.length === 0 && <div className="hint" style={{ paddingLeft: 24 }}>호출부 없음</div>}
                </div>
              ))}
            </>
          )
        )}
        {!indexing && tab !== 'flow' && !root && <div className="hint">심볼 위에 커서를 두세요</div>}
        {!indexing && root && tab === 'refs' && (
          refs.length === 0 ? <div className="hint">참조 없음</div> : (
            <>
              <div className="hint">참조 {refs.length}개{refs.length === 200 ? ' — 상위 200개만 표시' : ''}</div>
              {groupByPath(refs).map(([path, group]) => (
                <div key={path}>
                  <div className="rel-group">{path} ({group.length})</div>
                  {group.map((r, i) => (
                    <div key={i} className="rel-item" style={{ paddingLeft: 8 }} onClick={() => jumpTo(r.path, r.line)}>
                      <span className="rel-label">{r.enclosingName ?? '(파일)'}<span className="rel-kind"> {r.kind}</span></span>
                      <span className="rel-detail">:{r.line}</span>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )
        )}
        {!indexing && root && tab !== 'refs' && tab !== 'flow' && (
          nodes.length === 0 ? <div className="hint">{tab === 'class' ? '클래스 관계 없음' : '결과 없음'}</div> : renderNodes(nodes, 0)
        )}
      </div>
    </div>
  );
}
