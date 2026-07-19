import { useCallback, useEffect, useMemo, useState } from 'react';
import { VscRefresh, VscCheckAll, VscChevronRight, VscChevronDown } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { mapChangesToSymbols, FILE_LEVEL_NAME, type SymbolChange } from '../../../shared/review-map';
import { sortFilesByImpact, sortSymbolsByImpact } from '../../../shared/review-impact';
import type { ImpactSummary } from '../../../indexer/api';
import type { ReviewChangedFile, ReviewCommit, ReviewCommitsResult } from '../../../shared/protocol';

// 변경 리뷰 센터 (Plan 22) — baseline 이후 누적 변경을 파일→심볼 트리로 보여주고, 심볼별 리뷰 체크 + 진행률.
interface FileEntry {
  path: string;
  status: ReviewChangedFile['status'];
  binary: boolean;
  before: string;
  after: string;
  symbols: SymbolChange[]; // 비어 있으면(바이너리/미지원/무심볼) 파일 자체가 리뷰 단위
}

const STATUS_LABEL: Record<ReviewChangedFile['status'], string> = { A: '추가', M: '수정', D: '삭제' };
const CHANGE_LABEL: Record<SymbolChange['change'], string> = { added: '추가', modified: '수정', deleted: '삭제' };

/** 파일의 리뷰 리프 키 목록 — 심볼이 있으면 "path#name", 없으면 "path" 하나. */
function leafKeys(f: FileEntry): string[] {
  return f.symbols.length ? f.symbols.map((s) => `${f.path}#${s.name}`) : [f.path];
}

const shortHash = (h: string | null | undefined) => (h ? h.slice(0, 7) : '');

/** 콜러 배지 툴팁 — topCallers를 "name — path:line"(1-based) 줄로. 삭제 심볼이면 경고 헤더. */
function callerTitle(im: ImpactSummary, deleted: boolean): string {
  const lines = im.topCallers.map((c) => `${c.name ?? '(파일 최상위)'} — ${c.path}:${c.line + 1}`);
  const head = deleted ? '삭제된 심볼을 아직 호출하는 곳이 있습니다\n' : '';
  return head + lines.join('\n');
}

/** API 배지 툴팁 — 핸들러 엔드포인트/매칭 백엔드 호출을 구분 표기. */
function apiTitle(im: ImpactSummary): string {
  const parts: string[] = [];
  if (im.endpoints > 0) parts.push(`이 심볼이 핸들러인 엔드포인트 ${im.endpoints}개`);
  if (im.apiCalls > 0) parts.push(`매칭된 백엔드 호출 ${im.apiCalls}건`);
  return parts.join('\n');
}

export function ReviewCenterView() {
  const [meta, setMeta] = useState<ReviewCommitsResult | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [impacts, setImpacts] = useState<Map<string, ImpactSummary>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, state, changes] = await Promise.all([
      window.si.reviewCommits(),
      window.si.reviewStateGet(),
      window.si.reviewChanges(),
    ]);
    setMeta(m);
    setReviewed(new Set(state.reviewed));
    if (!m.isGit) {
      setFiles([]);
      setLoading(false);
      return;
    }
    const entries = await Promise.all(
      changes.map(async (c): Promise<FileEntry> => {
        const d = await window.si.reviewFileDiff(c.path).catch(() => null);
        if (!d || d.binary) return { path: c.path, status: c.status, binary: !!d?.binary, before: '', after: '', symbols: [] };
        const [oldSyms, newSyms] = await Promise.all([
          d.before ? window.si.extractSymbols(c.path, d.before).catch(() => []) : Promise.resolve([]),
          d.after ? window.si.extractSymbols(c.path, d.after).catch(() => []) : Promise.resolve([]),
        ]);
        const symbols = mapChangesToSymbols(d.hunks, oldSyms, newSyms);
        return { path: c.path, status: c.status, binary: false, before: d.before, after: d.after, symbols };
      }),
    );
    // 영향도 요약 — 전체 심볼 이름(중복 제거, 파일수준 제외)으로 1회 조회. 인덱서 미준비/오류는 조용히 생략.
    const names = [...new Set(entries.flatMap((e) => e.symbols.map((s) => s.name)))].filter((n) => n !== FILE_LEVEL_NAME);
    const summaries = names.length
      ? await window.si.getImpactSummaries(names).catch(() => [] as ImpactSummary[])
      : [];
    setImpacts(new Map(summaries.map((s) => [s.name, s])));
    setFiles(entries);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allLeaves = useMemo(() => files.flatMap(leafKeys), [files]);
  const doneCount = allLeaves.filter((k) => reviewed.has(k)).length;
  // 영향도 정렬: 파일은 내부 최대 영향도 내림차순(동률=경로순), 심볼은 파일 내에서 영향도 내림차순(동률=기존 순서).
  const sortedFiles = useMemo(() => sortFilesByImpact(files, impacts), [files, impacts]);

  // 콜러 배지 클릭 — cursorSymbol 지정 후 Relation 패널로 전환해 콜러 상세 확인.
  const openRelation = (path: string, s: SymbolChange) => {
    useAppStore.getState().setCursorSymbol({ name: s.name, path, line: s.line, col: 0 });
    useAppStore.getState().setRightTab('relation');
  };

  const persist = (next: Set<string>) => {
    setReviewed(next);
    void window.si.reviewStateSave({ baseline: meta?.baseline ?? null, reviewed: [...next] });
  };
  const toggleLeaf = (key: string) => {
    const next = new Set(reviewed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(next);
  };
  const toggleFile = (f: FileEntry) => {
    const keys = leafKeys(f);
    const allDone = keys.every((k) => reviewed.has(k));
    const next = new Set(reviewed);
    for (const k of keys) {
      if (allDone) next.delete(k);
      else next.add(k);
    }
    persist(next);
  };
  const toggleExpand = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const openFileDiff = (f: FileEntry, revealLine?: number) => {
    if (f.binary) return; // 바이너리는 diff 미표시
    const base = f.path.split('/').pop() ?? f.path;
    useAppStore.getState().openDiffTab(f.path, f.before, f.after, `리뷰: ${base}`, 'review', revealLine);
  };

  // "여기부터 리뷰" — baseline = 해당 커밋의 부모(<hash>^). 최초 커밋이면 부모가 없어 main이 HEAD로 폴백(단순 처리).
  const startFrom = (hash: string) => {
    void window.si.reviewStateSave({ baseline: `${hash}^`, reviewed: [] }).then(() => load());
  };
  const finishReview = () => {
    if (!meta?.head) return;
    if (!window.confirm('베이스라인을 현재 HEAD로 옮기고 리뷰 체크를 모두 비웁니다. 계속할까요?')) return;
    void window.si.reviewStateSave({ baseline: meta.head, reviewed: [] }).then(() => load());
  };

  if (loading && !meta) return <div className="review"><div className="hint">불러오는 중…</div></div>;
  if (meta && !meta.isGit) return <div className="review"><div className="hint">git 저장소가 아닙니다.</div></div>;

  return (
    <div className="review">
      <div className="review-topbar">
        <div className="review-baseline">
          <b>{shortHash(meta?.baseline)}</b> · 커밋 {meta?.sinceCommits.length ?? 0}개 · 파일 {files.length}개
        </div>
        <div className="review-progress">리뷰 {doneCount}/{allLeaves.length}</div>
        <button className="rename-btn" onClick={() => void load()} title="새로고침"><VscRefresh /> 새로고침</button>
        <button className="rename-btn primary" onClick={finishReview} disabled={!meta?.head} title="베이스라인을 HEAD로">
          <VscCheckAll /> 리뷰 완료
        </button>
      </div>
      <div className="review-body">
        <div className="review-commits">
          <div className="review-section-title">
            {meta && meta.sinceCommits.length > 0 ? '베이스라인 이후 커밋' : '최근 커밋 (시작점 선택)'}
          </div>
          {(meta && meta.sinceCommits.length > 0 ? meta.sinceCommits : meta?.recentCommits ?? []).map((c: ReviewCommit) => (
            <div key={c.hash} className="review-commit">
              <div className="review-commit-main">
                <span className="review-commit-hash">{shortHash(c.hash)}</span>
                <span className="review-commit-subject" title={c.subject}>{c.subject}</span>
              </div>
              <button className="review-commit-from" onClick={() => startFrom(c.hash)}>여기부터 리뷰</button>
            </div>
          ))}
          {meta && meta.sinceCommits.length === 0 && meta.recentCommits.length === 0 && (
            <div className="hint">커밋이 없습니다.</div>
          )}
        </div>
        <div className="review-files">
          {files.length === 0 && <div className="hint">{loading ? '불러오는 중…' : '변경이 없습니다.'}</div>}
          {sortedFiles.map((f) => {
            const keys = leafKeys(f);
            const fileDone = keys.every((k) => reviewed.has(k));
            const isOpen = expanded.has(f.path);
            const syms = sortSymbolsByImpact(f.symbols, impacts);
            return (
              <div key={f.path} className="review-file-group">
                <div className="review-file-row">
                  <span className="review-caret" onClick={() => toggleExpand(f.path)}>
                    {f.symbols.length > 0 ? (isOpen ? <VscChevronDown /> : <VscChevronRight />) : <span className="review-caret-spacer" />}
                  </span>
                  <input type="checkbox" checked={fileDone} onChange={() => toggleFile(f)} onClick={(e) => e.stopPropagation()} />
                  <span className={`review-status review-status-${f.status}`}>{STATUS_LABEL[f.status]}</span>
                  <span className="review-file-path" onClick={() => openFileDiff(f)} title={f.path}>{f.path}</span>
                  {f.binary && <span className="review-binary">바이너리</span>}
                </div>
                {isOpen && syms.map((s) => {
                  const key = `${f.path}#${s.name}`;
                  const im = impacts.get(s.name);
                  const deleted = s.change === 'deleted';
                  return (
                    <div key={key} className="review-symbol-row">
                      <input type="checkbox" checked={reviewed.has(key)} onChange={() => toggleLeaf(key)} />
                      <span className={`review-badge review-badge-${s.change}`}>{CHANGE_LABEL[s.change]}</span>
                      <span className="review-symbol-name" onClick={() => openFileDiff(f, s.line)}>{s.name}</span>
                      {im && im.callers > 0 && (
                        <span
                          className={`review-impact review-impact-callers ${im.callers >= 5 ? 'is-danger' : 'is-warn'}${deleted ? ' is-orphan' : ''}`}
                          title={callerTitle(im, deleted)}
                          onClick={() => openRelation(f.path, s)}
                        >
                          콜러 {im.callers}{deleted ? ' ⚠' : ''}
                        </span>
                      )}
                      {im && (im.endpoints > 0 || im.apiCalls > 0) && (
                        <span className="review-impact review-impact-api" title={apiTitle(im)}>API</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
