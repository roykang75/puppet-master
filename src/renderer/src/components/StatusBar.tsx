import { useAppStore } from '../store';

export function StatusBar() {
  const indexing = useAppStore((s) => s.indexing);
  const stats = useAppStore((s) => s.stats);
  const error = useAppStore((s) => s.error);
  const activePath = useAppStore((s) => s.activePath);
  return (
    <div className="statusbar">
      <span>
        {error ? <span className="error">{error}</span>
          : indexing ? `인덱싱 ${indexing.done}/${indexing.total}`
          : stats ? `파일 ${stats.files + stats.skipped} · 심볼 ${stats.symbols}`
          : ''}
      </span>
      <span>{activePath ?? ''}</span>
    </div>
  );
}
