import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { createTerminalView, getTerminalView, disposeAllTerminalViews } from '../terminal-view';

export function TerminalPanel({ visible }: { visible: boolean }) {
  const terminals = useAppStore((s) => s.terminals);
  const activeId = useAppStore((s) => s.activeTerminalId);
  const hostRef = useRef<HTMLDivElement>(null);

  // 이벤트 구독 — TerminalPanel은 CSS 숨김으로만 가려지고 언마운트되지 않는다 (BottomPanel 계약)
  useEffect(() => {
    const off = window.si.onTerminalEvent((e) => {
      if (e.type === 'data') getTerminalView(e.id)?.write(e.data);
      else useAppStore.getState().markTerminalExited(e.id);
    });
    return () => {
      off();
      disposeAllTerminalViews(); // 프로젝트 전환(Workspace 재마운트) 시 정리
    };
  }, []);

  const spawn = async () => {
    const r = await window.si.terminalSpawn();
    if ('error' in r) {
      useAppStore.getState().setError(`터미널 시작 실패: ${r.error}`);
      return;
    }
    const st = useAppStore.getState();
    st.addTerminal(r.id, `터미널 ${r.id}`);
    // 컨테이너가 렌더된 다음 프레임에 뷰 생성
    requestAnimationFrame(() => {
      const el = hostRef.current?.querySelector<HTMLElement>(`[data-term-id="${r.id}"]`);
      if (el) createTerminalView(r.id, el).focus();
    });
  };

  // 터미널 탭 첫 표시 시 지연 기동
  useEffect(() => {
    if (visible && useAppStore.getState().terminals.length === 0) void spawn();
    if (visible && activeId != null) requestAnimationFrame(() => getTerminalView(activeId)?.fit());
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (id: number) => {
    void window.si.terminalKill(id);
    getTerminalView(id)?.dispose();
    useAppStore.getState().removeTerminal(id);
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-tabs">
        {terminals.map((t) => (
          <span
            key={t.id}
            className={`terminal-tab${t.id === activeId ? ' active' : ''}`}
            onClick={() => {
              useAppStore.getState().setActiveTerminalId(t.id);
              requestAnimationFrame(() => getTerminalView(t.id)?.fit());
            }}
          >
            {t.title}{t.exited ? ' (종료됨)' : ''}
            <button className="terminal-close" onClick={(e) => { e.stopPropagation(); close(t.id); }}>×</button>
          </span>
        ))}
        <button className="terminal-add" onClick={() => void spawn()}>+</button>
      </div>
      <div className="terminal-hosts" ref={hostRef}>
        {terminals.length === 0 && (
          <div className="hint">터미널이 없습니다. + 로 새 터미널을 여세요.</div>
        )}
        {terminals.map((t) => (
          <div
            key={t.id}
            data-term-id={t.id}
            className="terminal-host"
            style={{ display: t.id === activeId ? 'block' : 'none' }}
          />
        ))}
      </div>
    </div>
  );
}
