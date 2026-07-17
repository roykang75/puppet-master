import { useState } from 'react';
import { VscArrowLeft, VscArrowRight, VscCircleFilled, VscClose, VscEllipsis, VscWarning } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { fileIconUrl } from '../file-icons';
import { disposeModel } from './EditorPane';
import { goBack, goForward } from '../navigation';

export function FileTabs() {
  const tabs = useAppStore((s) => s.tabs);
  const activePath = useAppStore((s) => s.activePath);
  const setActive = useAppStore((s) => s.setActive);
  const closeTab = useAppStore((s) => s.closeTab);
  const [listOpen, setListOpen] = useState(false);

  const close = (path: string) => {
    disposeModel(path);
    closeTab(path);
  };

  return (
    <div className="tabs">
      <div className="nav-buttons">
        <span className="nav-btn" title="뒤로 (Alt+←)" onClick={goBack}><VscArrowLeft /></span>
        <span className="nav-btn" title="앞으로 (Alt+→)" onClick={goForward}><VscArrowRight /></span>
      </div>
      <div className="tab-strip">
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
                close(t.path);
              }}
            >
              <VscClose />
            </span>
          </div>
        ))}
      </div>
      <div className="tabs-actions">
        <span className="nav-btn tabs-more" title="열린 파일 목록" onClick={() => setListOpen((o) => !o)}><VscEllipsis /></span>
      </div>
      {listOpen && (
        <>
          <div className="open-editors-backdrop" onMouseDown={() => setListOpen(false)} />
          <div className="open-editors-menu">
            <div className="open-editors-title">열린 파일 {tabs.length}개</div>
            {tabs.map((t) => {
              const name = t.path.split('/').pop() ?? t.path;
              const dir = t.path.slice(0, Math.max(0, t.path.length - name.length - 1));
              return (
                <div
                  key={t.path}
                  className={`open-editors-item${t.path === activePath ? ' active' : ''}`}
                  onClick={() => {
                    setActive(t.path);
                    setListOpen(false);
                  }}
                >
                  <img className="file-icon tab-file-icon" src={fileIconUrl(name)} alt="" />
                  <span className="open-editors-name">{name}</span>
                  {t.dirty && <span className="dirty-dot"><VscCircleFilled /></span>}
                  <span className="open-editors-dir">{dir}</span>
                  <span
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      close(t.path);
                    }}
                  >
                    <VscClose />
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
