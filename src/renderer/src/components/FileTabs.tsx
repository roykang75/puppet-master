import { VscArrowLeft, VscArrowRight, VscCircleFilled, VscClose, VscWarning } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { fileIconUrl } from '../file-icons';
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
        <span className="nav-btn" title="뒤로 (Alt+←)" onClick={goBack}><VscArrowLeft /></span>
        <span className="nav-btn" title="앞으로 (Alt+→)" onClick={goForward}><VscArrowRight /></span>
      </div>
      {tabs.map((t) => (
        <div key={t.path} className={`tab${t.path === activePath ? ' active' : ''}`} onClick={() => setActive(t.path)}>
          <img className="file-icon tab-file-icon" src={fileIconUrl(t.path.split('/').pop() ?? '')} alt="" />
          <span>{t.path.split('/').pop()}</span>
          {t.dirty && <span className="dirty-dot"><VscCircleFilled /></span>}
          {t.diskChanged && <span className="disk-changed" title="디스크에서 변경됨"><VscWarning /></span>}
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              disposeModel(t.path);
              closeTab(t.path);
            }}
          >
            <VscClose />
          </span>
        </div>
      ))}
    </div>
  );
}
