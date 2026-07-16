import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startIndexerHost } from '../src/indexer/host-core';
import { createRpcClient, Transport } from '../src/shared/rpc';
import { PROTOCOL_VERSION, ReadyPayload } from '../src/shared/protocol';
import type { IndexStats } from '../src/indexer/pipeline';
import type { SymbolHit } from '../src/indexer/api';
import type { RpcMessage } from '../src/shared/protocol';

function makePair(): { client: Transport; server: Transport } {
  const toServer: Array<(m: RpcMessage) => void> = [];
  const toClient: Array<(m: RpcMessage) => void> = [];
  return {
    client: { post: (m) => queueMicrotask(() => toServer.forEach((cb) => cb(m))), onMessage: (cb) => toClient.push(cb) },
    server: { post: (m) => queueMicrotask(() => toClient.forEach((cb) => cb(m))), onMessage: (cb) => toServer.push(cb) },
  };
}

let root: string;
let work: string;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-host-'));
  root = path.join(work, 'proj');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.ts'), 'export function alpha() { return 1; }\n');
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('indexer host', () => {
  it('ready → openProject → 조회 → indexFile 이벤트 흐름', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    const events: Array<{ event: string; payload: unknown }> = [];
    const readyP = new Promise<ReadyPayload>((r) =>
      rpc.onEvent((event, payload) => {
        events.push({ event, payload });
        if (event === 'ready') r(payload as ReadyPayload);
      }),
    );
    const host = startIndexerHost(server);

    const ready = await readyP;
    expect(ready.protocolVersion).toBe(PROTOCOL_VERSION);

    const stats = await rpc.request<IndexStats>('openProject', {
      root,
      dbPath: path.join(work, 'index', 'test.db'),
    }, { timeoutMs: 60_000 });
    expect(stats.files).toBe(1);

    await expect(
      rpc.request('openProject', { root, dbPath: path.join(work, 'index', 'test.db') }),
    ).rejects.toThrow('project already open');

    const outline = await rpc.request<SymbolHit[]>('getFileOutline', { path: 'a.ts' });
    expect(outline.map((s) => s.name)).toContain('alpha');

    // 파일 갱신 → indexFile → fileIndexed 이벤트
    fs.writeFileSync(path.join(root, 'a.ts'), 'export function alpha() { return 1; }\nexport function beta() { return 2; }\n');
    const res = await rpc.request<{ indexed: boolean }>('indexFile', { path: 'a.ts' });
    expect(res.indexed).toBe(true);
    expect(events.some((e) => e.event === 'fileIndexed' && (e.payload as { path: string }).path === 'a.ts')).toBe(true);

    const outline2 = await rpc.request<SymbolHit[]>('getFileOutline', { path: 'a.ts' });
    expect(outline2.map((s) => s.name)).toContain('beta');

    // indexBuffer: 디스크 미저장 내용 인덱싱 + source:'buffer' 이벤트
    const res3 = await rpc.request<{ indexed: boolean }>('indexBuffer', {
      path: 'a.ts',
      content: 'export function alpha() { return 1; }\nexport function beta() { return 2; }\nexport function gamma() { return 3; }\n',
    });
    expect(res3.indexed).toBe(true);
    expect(events.some((e) => e.event === 'fileIndexed' && (e.payload as { source?: string }).source === 'buffer')).toBe(true);
    const outline3 = await rpc.request<SymbolHit[]>('getFileOutline', { path: 'a.ts' });
    expect(outline3.map((s) => s.name)).toContain('gamma');

    // 프로젝트 미오픈 상태 보호는 별도 인스턴스로 확인
    const pair2 = makePair();
    const rpc2 = createRpcClient(pair2.client);
    const host2 = startIndexerHost(pair2.server);
    await expect(rpc2.request('getFileOutline', { path: 'a.ts' })).rejects.toThrow('project not open');
    await host2.close();

    await host.close();
  }, 60_000);
});
