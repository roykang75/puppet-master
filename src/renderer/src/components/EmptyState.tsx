import { useEffect, useState } from 'react';

export function EmptyState({ onOpen }: { onOpen: (root: string) => void }) {
  const [recent, setRecent] = useState<Array<{ root: string }>>([]);
  useEffect(() => {
    void window.si.getRecent().then(setRecent);
  }, []);
  const pick = async () => {
    const root = await window.si.openFolderDialog();
    if (root) onOpen(root);
  };
  return (
    <div className="empty-state">
      <h2>SourceInSight</h2>
      <button onClick={() => void pick()}>폴더 열기</button>
      {recent.length > 0 && (
        <div className="recent-list">
          {recent.map((r) => (
            <div key={r.root} className="recent-item" onClick={() => onOpen(r.root)}>
              {r.root}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
