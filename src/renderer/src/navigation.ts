import { useAppStore } from './store';

export interface Loc {
  path: string;
  line: number;
  col: number;
}

const MAX = 100;
const same = (a: Loc | undefined, b: Loc) => !!a && a.path === b.path && a.line === b.line && a.col === b.col;

/** 뒤로/앞으로 스택. push는 "점프 직전 현재 위치"를 기록한다. */
export class NavHistory {
  private backStack: Loc[] = [];
  private forwardStack: Loc[] = [];

  push(loc: Loc): void {
    if (same(this.backStack[this.backStack.length - 1], loc)) return;
    this.backStack.push(loc);
    if (this.backStack.length > MAX) this.backStack.shift();
    this.forwardStack = [];
  }

  back(current: Loc): Loc | null {
    const prev = this.backStack.pop();
    if (!prev) return null;
    this.forwardStack.push(current);
    return prev;
  }

  forward(current: Loc): Loc | null {
    const next = this.forwardStack.pop();
    if (!next) return null;
    this.backStack.push(current);
    return next;
  }

  reset(): void {
    this.backStack = [];
    this.forwardStack = [];
  }

  get canBack(): boolean {
    return this.backStack.length > 0;
  }
  get canForward(): boolean {
    return this.forwardStack.length > 0;
  }
}

export const navHistory = new NavHistory();

let currentLocProvider: (() => Loc | null) | null = null;
export function setCurrentLocProvider(fn: () => Loc | null): void {
  currentLocProvider = fn;
}

/** 모든 점프의 단일 진입점: 현재 위치를 히스토리에 push하고 대상 열기+이동. line/col은 1-based. */
export function jumpTo(path: string, line: number, col = 1): void {
  const cur = currentLocProvider?.();
  if (cur) navHistory.push(cur);
  const st = useAppStore.getState();
  st.openTab(path);
  st.setPendingJump({ path, line, col });
}

export function goBack(): void {
  const cur = currentLocProvider?.();
  if (!cur) return;
  const prev = navHistory.back(cur);
  if (!prev) return;
  const st = useAppStore.getState();
  st.openTab(prev.path);
  st.setPendingJump(prev);
}

export function goForward(): void {
  const cur = currentLocProvider?.();
  if (!cur) return;
  const next = navHistory.forward(cur);
  if (!next) return;
  const st = useAppStore.getState();
  st.openTab(next.path);
  st.setPendingJump(next);
}
