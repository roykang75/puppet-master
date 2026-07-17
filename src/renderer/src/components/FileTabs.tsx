import { useEffect, useRef, useState } from 'react';
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
  const [focusIdx, setFocusIdx] = useState(0); // 키보드 하이라이트 위치
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (path: string) => {
    disposeModel(path);
    closeTab(path);
  };

  // 메뉴가 열리면 포커스를 가져와 ↑/↓/Enter/Esc를 받는다 (열 때 활성 파일 위치에서 시작)
  useEffect(() => {
    if (!listOpen) return;
    const idx = tabs.findIndex((t) => t.path === activePath);
    setFocusIdx(idx >= 0 ? idx : 0);
    menuRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listOpen]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      // ←/→도 이동 — 탭이 가로 배열이라 좌우 키로 앞/뒤 파일을 오가는 게 자연스럽다
      const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const next = (focusIdx + delta + tabs.length) % tabs.length;
      setFocusIdx(next);
      menuRef.current
        ?.querySelectorAll('.open-editors-item')
        [next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = tabs[focusIdx];
      if (t) setActive(t.path);
      setListOpen(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setListOpen(false);
    }
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
          <div className="open-editors-menu" ref={menuRef} tabIndex={-1} onKeyDown={onMenuKey}>
            <div className="open-editors-title">열린 파일 {tabs.length}개</div>
            {tabs.map((t, i) => {
              const name = t.path.split('/').pop() ?? t.path;
              const dir = t.path.slice(0, Math.max(0, t.path.length - name.length - 1));
              return (
                <div
                  key={t.path}
                  className={`open-editors-item${t.path === activePath ? ' active' : ''}${i === focusIdx ? ' focused' : ''}`}
                  onMouseMove={() => setFocusIdx(i)}
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
