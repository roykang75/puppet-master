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
    // 가상 탭(diff/dircmp/review)은 세션 한정 — 저장 제외. 복원은 openTab(path)로만 이뤄져
    // 탭에 붙은 상태(diff/dirCompare/review 플래그)를 되살릴 수 없고, 껍데기 탭이 빈 화면으로 남는다.
    const virtualTab = (t: (typeof s.tabs)[number]) => !!t.diff || !!t.dirCompare || !!t.review;
    const openTabs = s.tabs.filter((t) => !virtualTab(t)).map((t) => t.path);
    const activeTab = openTabs.includes(s.activePath ?? '') ? s.activePath : (openTabs.at(-1) ?? null);
    void window.si.saveUiState({ panelLayouts, openTabs, activeTab });
  }, 500);
}
