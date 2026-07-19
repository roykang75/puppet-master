import { useAppStore } from '../store';
import { buildCompareDiff } from '../compare';
import type { DirCompareEntry } from '../../../shared/protocol';

const STATUS_LABEL: Record<DirCompareEntry['status'], string> = {
  'left-only': '왼쪽만',
  'right-only': '오른쪽만',
  different: '다름',
};

// 디렉터리 비교 결과 목록 — 행 클릭 시 파일 diff(다름) 또는 단일 파일(한쪽만) 열기.
export function DirCompareView({ leftDir, rightDir, entries }: { leftDir: string; rightDir: string; entries: DirCompareEntry[] }) {
  const open = async (e: DirCompareEntry) => {
    const st = useAppStore.getState();
    if (e.status === 'left-only') return st.openTab(`${leftDir}/${e.relPath}`.replace(/^\//, ''));
    if (e.status === 'right-only') return st.openTab(`${rightDir}/${e.relPath}`.replace(/^\//, ''));
    const lp = `${leftDir}/${e.relPath}`.replace(/^\//, '');
    const rp = `${rightDir}/${e.relPath}`.replace(/^\//, '');
    const [before, after] = await Promise.all([
      window.si.readFile(lp).catch(() => null),
      window.si.readFile(rp).catch(() => null),
    ]);
    if (before == null || after == null) return;
    const d = buildCompareDiff(lp, before, rp, after);
    st.openDiffTab(d.path, d.before, d.after, d.label);
  };
  return (
    <div className="dircmp">
      <div className="dircmp-head">{leftDir || '.'} ↔ {rightDir || '.'} · 차이 {entries.length}건</div>
      {entries.length === 0 && <div className="hint">차이가 없습니다.</div>}
      {entries.map((e) => (
        <div key={e.relPath} className={`dircmp-row dircmp-${e.status}`} onClick={() => void open(e)}>
          <span className="dircmp-status">{STATUS_LABEL[e.status]}</span>
          <span className="dircmp-path">{e.relPath}</span>
        </div>
      ))}
    </div>
  );
}
