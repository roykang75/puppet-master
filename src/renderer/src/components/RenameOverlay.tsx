import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { getContent } from './EditorPane';
import type { RenameFileGroup, RenameOccurrence, RenameTargets, RenameApplyResult } from '../../../shared/protocol';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const keyOf = (path: string, occ: RenameOccurrence): string => `${path}:${occ.line}:${occ.col}`;

export function RenameOverlay() {
  const request = useAppStore((s) => s.renameRequest);
  const setRenameRequest = useAppStore((s) => s.setRenameRequest);
  const tabs = useAppStore((s) => s.tabs);

  const [targets, setTargets] = useState<RenameTargets | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<Map<string, string[]>>(new Map());
  const [newName, setNewName] = useState('');
  const [phase, setPhase] = useState<'select' | 'applying' | 'done'>('select');
  const [result, setResult] = useState<RenameApplyResult | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const oldName = request?.name ?? '';

  // 오버레이 열림 — 대상 로드 + 미리보기 줄 로드 + 초기 체크 상태
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setTargets(null);
    setChecked(new Set());
    setLines(new Map());
    setNewName(request.name);
    setPhase('select');
    setResult(null);
    setBlocked(null);
    setLoadError(null);
    setTimeout(() => inputRef.current?.focus(), 0);

    void window.si
      .getRenameTargets(request.name)
      .then(async (t) => {
        if (cancelled) return;
        setTargets(t);
        // 파일 그룹은 기본 체크, unconfirmed는 기본 해제
        const initial = new Set<string>();
        for (const g of t.groups) for (const occ of g.occurrences) initial.add(keyOf(g.path, occ));
        setChecked(initial);
        // 파일별 미리보기 줄 로드 (그룹당 1회)
        const paths = [...new Set([...t.groups, ...t.unconfirmed].map((g) => g.path))];
        const map = new Map<string, string[]>();
        await Promise.all(
          paths.map(async (p) => {
            const content = getContent(p) ?? (await window.si.readFile(p).catch(() => null));
            if (content != null) map.set(p, content.split('\n'));
          }),
        );
        if (!cancelled) setLines(map);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  const allGroups = useMemo(
    () => (targets ? [...targets.groups, ...targets.unconfirmed] : []),
    [targets],
  );

  const checkedGroups = useMemo<RenameFileGroup[]>(() => {
    const out: RenameFileGroup[] = [];
    for (const g of allGroups) {
      const occs = g.occurrences.filter((o) => checked.has(keyOf(g.path, o)));
      if (occs.length > 0) out.push({ path: g.path, occurrences: occs });
    }
    return out;
  }, [allGroups, checked]);

  if (!request) return null;

  const close = () => {
    if (phase === 'applying') return; // 진행 중 닫기 방지
    setRenameRequest(null);
  };

  const toggleOcc = (path: string, occ: RenameOccurrence) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const k = keyOf(path, occ);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleGroup = (g: RenameFileGroup) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const allOn = g.occurrences.every((o) => next.has(keyOf(g.path, o)));
      for (const o of g.occurrences) {
        const k = keyOf(g.path, o);
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const nameValid = IDENT_RE.test(newName);
  const nameSame = newName === oldName;
  const hasChecked = checkedGroups.length > 0;
  const canApply = phase === 'select' && nameValid && !nameSame && hasChecked;

  const apply = () => {
    if (!canApply) return;
    // 체크된 그룹의 path 중 dirty 탭이 있으면 차단
    const dirtyPaths = checkedGroups
      .map((g) => g.path)
      .filter((p) => tabs.some((t) => t.path === p && t.dirty));
    if (dirtyPaths.length > 0) {
      setBlocked(`저장되지 않은 변경이 있습니다 (${dirtyPaths.join(', ')}). 저장 후 다시 시도하세요.`);
      return;
    }
    setBlocked(null);
    setPhase('applying');
    void window.si
      .applyRename(oldName, newName, checkedGroups)
      .then((r) => {
        setResult(r);
        setPhase('done');
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setPhase('select');
      });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const renderGroup = (g: RenameFileGroup) => {
    const fileLines = lines.get(g.path);
    const allOn = g.occurrences.every((o) => checked.has(keyOf(g.path, o)));
    const someOn = g.occurrences.some((o) => checked.has(keyOf(g.path, o)));
    return (
      <div className="rename-group" key={g.path}>
        <label className="rename-group-head">
          <input
            type="checkbox"
            checked={allOn}
            ref={(el) => {
              if (el) el.indeterminate = someOn && !allOn;
            }}
            onChange={() => toggleGroup(g)}
          />
          <span className="rename-group-path">{g.path}</span>
          <span className="rename-group-count">{g.occurrences.length}</span>
        </label>
        {g.occurrences.map((o) => (
          <label className="rename-item" key={keyOf(g.path, o)}>
            <input
              type="checkbox"
              checked={checked.has(keyOf(g.path, o))}
              onChange={() => toggleOcc(g.path, o)}
            />
            <span className="rename-item-line">:{o.line + 1}</span>
            <span className="rename-item-preview">{fileLines?.[o.line]?.trim() ?? ''}</span>
            {o.isDefinition && <span className="rename-item-def">def</span>}
          </label>
        ))}
      </div>
    );
  };

  return (
    <div className="search-backdrop" onClick={close}>
      <div className="search-box rename-box" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="rename-header">
          <span className="rename-title">이름 바꾸기: <b>{oldName}</b></span>
          <input
            ref={inputRef}
            className="rename-input"
            value={newName}
            placeholder="새 이름…"
            disabled={phase !== 'select'}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
        </div>

        {loadError && <div className="rename-summary rename-warn">오류: {loadError}</div>}
        {!nameValid && newName.length > 0 && (
          <div className="hint">유효한 식별자가 아닙니다 (문자/_/$ 로 시작).</div>
        )}
        {nameValid && nameSame && <div className="hint">기존 이름과 동일합니다.</div>}
        {blocked && <div className="rename-summary rename-warn">{blocked}</div>}

        {phase === 'done' && result ? (
          <div className="rename-results">
            <div className="rename-summary">
              {result.changedFiles}개 파일 {result.replaced}건 치환
            </div>
            {result.skipped.length > 0 && (
              <div className="rename-summary rename-warn">
                건너뜀 {result.skipped.length}건:
                <ul className="rename-skip-list">
                  {result.skipped.map((s, i) => (
                    <li key={i}>{s.path}:{s.line + 1}:{s.col + 1}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="search-results rename-list">
            {!targets && !loadError && <div className="hint">사용처 검색 중…</div>}
            {targets && allGroups.length === 0 && <div className="hint">사용처 없음</div>}
            {targets && targets.groups.map((g) => renderGroup(g))}
            {targets && targets.unconfirmed.length > 0 && (
              <>
                <div className="search-section">확인되지 않은 사용처</div>
                {targets.unconfirmed.map((g) => renderGroup(g))}
              </>
            )}
          </div>
        )}

        <div className="rename-actions">
          {phase === 'done' ? (
            <button className="rename-btn primary" onClick={close}>확인</button>
          ) : (
            <>
              <button className="rename-btn" onClick={close} disabled={phase === 'applying'}>취소</button>
              <button className="rename-btn primary" onClick={apply} disabled={!canApply}>
                {phase === 'applying' ? '적용 중…' : '적용'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
