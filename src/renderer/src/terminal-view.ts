// xterm 인스턴스 관리 — id별 생성/데이터/테마/리사이즈/정리. DOM 렌더러 유지 (addon 금지).
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface TerminalView {
  write(data: string): void;
  fit(): void;
  focus(): void;
  dispose(): void;
}

const views = new Map<number, TerminalView>();

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function themeOptions() {
  return {
    background: cssVar('--bg', '#1e1f22'),
    foreground: cssVar('--fg', '#d4d6da'),
    cursor: cssVar('--accent', '#4a9eff'),
  };
}

export function createTerminalView(id: number, container: HTMLElement): TerminalView {
  const term = new Terminal({
    theme: themeOptions(),
    fontSize: 12,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    cursorBlink: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  fit.fit();
  void window.si.terminalResize(id, term.cols, term.rows);

  term.onData((data) => void window.si.terminalInput(id, data));

  const ro = new ResizeObserver(() => {
    // 숨김(display:none) 상태에선 크기가 0 — fit 생략 (표시될 때 다시 관측됨)
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      fit.fit();
      void window.si.terminalResize(id, term.cols, term.rows);
    }
  });
  ro.observe(container);

  const onTheme = () => term.options && (term.options.theme = themeOptions());
  window.addEventListener('si:theme-changed', onTheme);

  const view: TerminalView = {
    write: (data) => term.write(data),
    fit: () => {
      if (container.clientWidth > 0) {
        fit.fit();
        void window.si.terminalResize(id, term.cols, term.rows);
      }
    },
    focus: () => term.focus(),
    dispose: () => {
      ro.disconnect();
      window.removeEventListener('si:theme-changed', onTheme);
      term.dispose();
      views.delete(id);
    },
  };
  views.set(id, view);
  return view;
}

export function getTerminalView(id: number): TerminalView | undefined {
  return views.get(id);
}

export function disposeAllTerminalViews(): void {
  for (const v of [...views.values()]) v.dispose();
}
