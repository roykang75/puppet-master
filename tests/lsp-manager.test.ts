import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, MessageConnection } from 'vscode-jsonrpc/node';
import { LspManager, ChildLike } from '../src/main/lsp/manager';
import type { LspSpawnSpec } from '../src/main/lsp/servers';

interface FakeServer { conn: MessageConnection; child: ChildLike; emitExit(code: number): void; log: { method: string; params: any }[] }

function makeFakeServer(caps: Record<string, unknown>): FakeServer {
  const c2s = new PassThrough();
  const s2c = new PassThrough();
  const em = new EventEmitter();
  const log: { method: string; params: any }[] = [];
  const conn = createMessageConnection(new StreamMessageReader(c2s), new StreamMessageWriter(s2c));
  conn.onRequest('initialize', () => ({ capabilities: caps }));
  conn.onNotification((method, params) => log.push({ method, params }));
  conn.onRequest('textDocument/completion', () => ({ items: [{ label: 'fromLsp', kind: 2 }] }));
  conn.onRequest('textDocument/hover', () => ({ contents: 'h' }));
  conn.onRequest('textDocument/definition', () => [
    { uri: 'file:///root/src/def.ts', range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } },
    { uri: 'file:///outside/x.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
  ]);
  conn.listen();
  const child: ChildLike = {
    stdout: s2c, stdin: c2s,
    on: (ev, cb) => { em.on(ev, cb); },
    kill: () => {},
  };
  return { conn, child, emitExit: (code) => em.emit('exit', code), log };
}

let servers: FakeServer[];
let spawned: LspSpawnSpec[];
let statuses: { lang: string; state: string }[];
let diags: { path: string; count: number }[];
let mgr: LspManager;

beforeEach(() => {
  servers = [];
  spawned = [];
  statuses = [];
  diags = [];
  mgr = new LspManager({
    root: '/root',
    onDiagnostics: (path, d) => diags.push({ path, count: d.length }),
    onStatus: (s) => statuses.push(s),
    spawnFn: (spec) => {
      spawned.push(spec);
      const s = makeFakeServer({ completionProvider: true, hoverProvider: true, definitionProvider: true });
      servers.push(s);
      return s.child;
    },
  });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LspManager', () => {
  it('didOpen이 지연 기동을 트리거하고 didOpen을 전달한다 (.c는 무시)', async () => {
    mgr.notify('didOpen', { path: 'src/a.ts', text: 'const x = 1;' });
    mgr.notify('didOpen', { path: 'src/b.c', text: 'int x;' });
    await wait(80);
    expect(spawned).toHaveLength(1); // ts만
    const open = servers[0].log.find((l) => l.method === 'textDocument/didOpen')!;
    expect(open.params.textDocument.uri).toBe('file:///root/src/a.ts');
    expect(open.params.textDocument.languageId).toBe('typescript');
    expect(statuses).toContainEqual({ lang: 'ts', state: 'running' });
  });

  it('같은 언어 두 번째 파일은 재스폰 없이 didOpen만', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: '1' });
    mgr.notify('didOpen', { path: 'b.ts', text: '2' });
    await wait(80);
    expect(spawned).toHaveLength(1);
    expect(servers[0].log.filter((l) => l.method === 'textDocument/didOpen')).toHaveLength(2);
  });

  it('didChange는 버전 증가 + Full 텍스트', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'v1' });
    await wait(50);
    mgr.notify('didChange', { path: 'a.ts', text: 'v2' });
    await wait(50);
    const ch = servers[0].log.find((l) => l.method === 'textDocument/didChange')!;
    expect(ch.params.contentChanges).toEqual([{ text: 'v2' }]);
    expect(ch.params.textDocument.version).toBe(2);
  });

  it('request 3종: convert 적용 + 프로젝트 밖 정의 필터', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'x' });
    await wait(80);
    const comp = (await mgr.request('completion', { path: 'a.ts', line: 0, col: 1 })) as any[];
    expect(comp[0].label).toBe('fromLsp');
    const hover = (await mgr.request('hover', { path: 'a.ts', line: 0, col: 1 })) as any;
    expect(hover.markdown).toBe('h');
    const defs = (await mgr.request('definition', { path: 'a.ts', line: 0, col: 1 })) as any[];
    expect(defs).toEqual([{ path: 'src/def.ts', line: 1, col: 2 }]); // 밖은 필터됨
  });

  it('서버 없는 확장자 request → null', async () => {
    expect(await mgr.request('completion', { path: 'a.c', line: 0, col: 0 })).toBeNull();
  });

  it('크래시 → 재시작 + 열린 문서 재전송, 3회 연속이면 stopped', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'keep' });
    await wait(80);
    servers[0].emitExit(1);
    await wait(80);
    expect(spawned).toHaveLength(2); // 재기동
    const reopened = servers[1].log.find((l) => l.method === 'textDocument/didOpen')!;
    expect(reopened.params.textDocument.text).toBe('keep');
    servers[1].emitExit(1);
    await wait(80);
    servers[2].emitExit(1);
    await wait(80);
    expect(spawned).toHaveLength(3); // 3회째 크래시 후 재기동 안 함
    expect(statuses.at(-1)).toEqual({ lang: 'ts', state: 'stopped' });
  });

  it('shutdownAll 후에는 exit가 재기동을 유발하지 않는다', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'x' });
    await wait(80);
    mgr.shutdownAll();
    servers[0].emitExit(0);
    await wait(80);
    expect(spawned).toHaveLength(1);
  });
});
