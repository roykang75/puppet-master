import { useAppStore } from './store';

let panelLayouts: Record<string, string> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

export function initLayouts(saved: Record<string, string> | undefined | null): void {
  panelLayouts = { ...(saved ?? {}) };
}

export const layoutStorage = {
  getItem: (name: string): string | null => panelLayouts[name] ?? null,
  setItem: (name: string, value: string): void => {
    panelLayouts[name] = value;
    scheduleSave();
  },
};

export function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const s = useAppStore.getState();
    if (!s.root) return;
    void window.si.saveUiState({
      panelLayouts,
      openTabs: s.tabs.filter((t) => !t.diff).map((t) => t.path), // 변경 제안(diff) 탭은 세션 한정 — 저장 제외
      activeTab: s.activePath,
    });
  }, 500);
}
