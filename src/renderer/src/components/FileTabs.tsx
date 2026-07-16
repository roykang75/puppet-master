import { useAppStore } from '../store';
import { disposeModel } from './EditorPane';
import { goBack, goForward } from '../navigation';

export function FileTabs() {
  const tabs = useAppStore((s) => s.tabs);
  const activePath = useAppStore((s) => s.activePath);
  const setActive = useAppStore((s) => s.setActive);
  const closeTab = useAppStore((s) => s.closeTab);
  return (
    <div className="tabs">
      <div className="nav-buttons">
        <span className="nav-btn" title="뒤로 (Alt+←)" onClick={goBack}>◀</span>
        <span className="nav-btn" title="앞으로 (Alt+→)" onClick={goForward}>▶</span>
      </div>
      {tabs.map((t) => (
        <div key={t.path} className={`tab${t.path === activePath ? ' active' : ''}`} onClick={() => setActive(t.path)}>
          <span>{t.path.split('/').pop()}</span>
          {t.dirty && <span className="dirty-dot">●</span>}
          {t.diskChanged && <span className="disk-changed" title="디스크에서 변경됨">⚠</span>}
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              disposeModel(t.path);
              closeTab(t.path);
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  );
}
