// 레이아웃 프리셋 — react-resizable-panels Group 임퍼러티브 핸들 레지스트리.
// App이 각 Group의 groupRef를 등록하면, 현재 레이아웃 캡처/프리셋 적용을 리마운트 없이 수행.
import type { LayoutSnapshot } from '../../shared/protocol';

interface GroupHandle {
  getLayout(): Record<string, number>;
  setLayout(layout: Record<string, number>): unknown;
}

const groups = new Map<string, () => GroupHandle | null>();

/** App에서 그룹 id별 핸들 getter 등록 (마운트 시 1회). */
export function registerLayoutGroup(id: string, getHandle: () => GroupHandle | null): void {
  groups.set(id, getHandle);
}

/** 현재 모든 그룹의 레이아웃 스냅샷. */
export function captureLayout(): LayoutSnapshot {
  const snap: LayoutSnapshot = {};
  for (const [id, get] of groups) {
    const h = get();
    if (h) snap[id] = h.getLayout();
  }
  return snap;
}

/** 스냅샷을 각 그룹에 적용 (없는 그룹/스냅샷은 건너뜀). */
export function applyLayout(snap: LayoutSnapshot): void {
  for (const [id, get] of groups) {
    const h = get();
    const layout = snap[id];
    if (h && layout) h.setLayout(layout);
  }
}
