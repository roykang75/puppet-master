import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLspSync } from '../src/renderer/src/lsp-sync';

let notifies: { kind: string; params: any }[];
let sync: ReturnType<typeof createLspSync>;

beforeEach(() => {
  vi.useFakeTimers();
  notifies = [];
  sync = createLspSync({
    lspNotify: async (kind, params) => {
      notifies.push({ kind, params });
    },
  });
});

describe('lsp-sync', () => {
  it('LSP 확장자만 통지 (.c 무시)', () => {
    sync.lspOpen('a.ts', 'x');
    sync.lspOpen('b.c', 'y');
    expect(notifies).toEqual([{ kind: 'didOpen', params: { path: 'a.ts', text: 'x' } }]);
  });

  it('didChange 200ms 디바운스 — 연속 변경은 마지막 것만', () => {
    sync.lspOpen('a.ts', 'v0');
    sync.lspChange('a.ts', 'v1');
    sync.lspChange('a.ts', 'v2');
    vi.advanceTimersByTime(150);
    expect(notifies.filter((n) => n.kind === 'didChange')).toHaveLength(0);
    vi.advanceTimersByTime(60);
    const changes = notifies.filter((n) => n.kind === 'didChange');
    expect(changes).toEqual([{ kind: 'didChange', params: { path: 'a.ts', text: 'v2' } }]);
  });

  it('lspFlush는 대기 중 변경을 즉시 전송', async () => {
    sync.lspOpen('a.ts', 'v0');
    sync.lspChange('a.ts', 'v1');
    await sync.lspFlush();
    expect(notifies.filter((n) => n.kind === 'didChange')).toEqual([
      { kind: 'didChange', params: { path: 'a.ts', text: 'v1' } },
    ]);
    vi.advanceTimersByTime(300); // 타이머가 남아 있어도 중복 전송 없음
    expect(notifies.filter((n) => n.kind === 'didChange')).toHaveLength(1);
  });

  it('close/save/closeAll', () => {
    sync.lspOpen('a.ts', 'x');
    sync.lspOpen('b.py', 'y');
    sync.lspSave('a.ts');
    sync.lspClose('a.ts');
    sync.lspCloseAll();
    expect(notifies.map((n) => n.kind)).toEqual(['didOpen', 'didOpen', 'didSave', 'didClose', 'didClose']);
    // closeAll은 아직 열려 있는 b.py만 didClose (a.ts는 이미 닫힘)
    expect(notifies.at(-1)!.params.path).toBe('b.py');
  });

  it('열리지 않은 파일의 change는 무시', () => {
    sync.lspChange('ghost.ts', 'x');
    vi.advanceTimersByTime(300);
    expect(notifies).toHaveLength(0);
  });
});
