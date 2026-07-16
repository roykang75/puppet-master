import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { revealLine } from './EditorPane';
import type { SymbolHit } from '../../../indexer/api';

const KIND_BADGE: Record<string, string> = {
  function: 'ƒ', method: 'ƒ', class: 'C', struct: 'S', interface: 'I',
  enum: 'E', type: 'T', variable: 'v', field: '·', macro: '#', namespace: 'N',
};

export function SymbolWindow() {
  const activePath = useAppStore((s) => s.activePath);
  const outlineVersion = useAppStore((s) => s.outlineVersion);
  const indexing = useAppStore((s) => s.indexing);
  const [symbols, setSymbols] = useState<SymbolHit[]>([]);

  useEffect(() => {
    if (!activePath || indexing) {
      setSymbols([]);
      return;
    }
    let cancelled = false;
    void window.si
      .getFileOutline(activePath)
      .then((hits) => {
        if (!cancelled) setSymbols(hits);
      })
      .catch(() => {
        if (!cancelled) setSymbols([]); // 인덱서 미기동/비지원 파일 등
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, outlineVersion, indexing]);

  return (
    <div className="panel">
      <div className="panel-title">Symbols</div>
      <div className="panel-body">
        {indexing && <div className="hint">인덱싱 중…</div>}
        {!indexing &&
          symbols.map((s) => (
            <div key={s.id} className="symbol-item" onClick={() => revealLine(s.line)}>
              <span className="symbol-kind">{KIND_BADGE[s.kind] ?? '?'}</span>
              {s.name}
              <span className="symbol-line">:{s.line}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
