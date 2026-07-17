// 문서 동기화 — didChange 200ms 디바운스 + lspCall 직전 플러시 (스펙 §4)
import { LSP_EXT_TO_LANGUAGE } from '../../shared/protocol';

const DEBOUNCE_MS = 200;

export function isLspPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return path.slice(dot).toLowerCase() in LSP_EXT_TO_LANGUAGE;
}

export interface LspSyncDeps {
  lspNotify(kind: 'didOpen' | 'didChange' | 'didClose' | 'didSave', params: { path: string; text?: string }): Promise<void>;
}

export function createLspSync(deps: LspSyncDeps) {
  const open = new Set<string>();
  const pending = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>();

  const sendChange = (path: string): void => {
    const p = pending.get(path);
    if (!p) return;
    pending.delete(path);
    clearTimeout(p.timer);
    void deps.lspNotify('didChange', { path, text: p.text });
  };

  return {
    isLspPath,
    lspOpen(path: string, text: string): void {
      if (!isLspPath(path) || open.has(path)) return;
      open.add(path);
      void deps.lspNotify('didOpen', { path, text });
    },
    lspChange(path: string, text: string): void {
      if (!open.has(path)) return;
      const prev = pending.get(path);
      if (prev) clearTimeout(prev.timer);
      pending.set(path, { text, timer: setTimeout(() => sendChange(path), DEBOUNCE_MS) });
    },
    async lspFlush(): Promise<void> {
      for (const path of [...pending.keys()]) sendChange(path);
    },
    lspSave(path: string): void {
      if (open.has(path)) void deps.lspNotify('didSave', { path });
    },
    lspClose(path: string): void {
      const p = pending.get(path);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(path);
      }
      if (open.delete(path)) void deps.lspNotify('didClose', { path });
    },
    lspCloseAll(): void {
      for (const path of [...open]) this.lspClose(path);
    },
  };
}

// 앱 전역 싱글턴 (테스트는 createLspSync로 주입 생성)
export const lspSync = createLspSync({ lspNotify: (k, p) => window.si.lspNotify(k, p) });
