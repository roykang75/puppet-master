import { VscBookmark, VscClose } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import { resolveBookmarkLine } from '../bookmarks';
import type { Bookmark } from '../bookmarks';

export function BookmarksSection() {
  const bookmarks = useAppStore((s) => s.bookmarks);
  const setBookmarks = useAppStore((s) => s.setBookmarks);

  const jump = async (bm: Bookmark) => {
    const symbols = await window.si.getFileOutline(bm.path).catch(() => []);
    jumpTo(bm.path, resolveBookmarkLine(symbols, bm));
  };
  const remove = (bm: Bookmark) => {
    const next = bookmarks.filter((b) => b !== bm);
    setBookmarks(next);
    void window.si.saveBookmarks(next);
  };

  return (
    <div className="panel">
      <div className="panel-title">Bookmarks</div>
      <div className="panel-body">
        {bookmarks.length === 0 && <div className="hint">Cmd/Ctrl+F2로 북마크 토글</div>}
        {bookmarks.map((bm, i) => (
          <div key={i} className="rel-item" style={{ paddingLeft: 8 }}>
            <span className="tree-icon"><VscBookmark /></span>
            <span className="rel-label" onClick={() => void jump(bm)}>
              {bm.anchorName ? `${bm.anchorName}+${bm.offset}` : `:${bm.line}`} <span className="rel-kind">{bm.text}</span>
            </span>
            <span className="rel-detail">{bm.path}</span>
            <span className="tab-close" onClick={() => remove(bm)}><VscClose /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
