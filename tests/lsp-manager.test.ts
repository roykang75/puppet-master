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
  conn.onRequest('textDocument/references', (p: any) => {
    log.push({ method: 'textDocument/references', params: p });
    return [
      { uri: 'file:///root/a.ts', range: { start: { line: 3, character: 4 }, end: { line: 3, character: 7 } } },
      { uri: 'file:///outside/y.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    ];
  });
  conn.onRequest('textDocument/signatureHelp', () => ({
    signatures: [{ label: 'foo(a)', parameters: [{ label: 'a' }] }],
    activeSignature: 0, activeParameter: 0,
  }));
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

  it('references: includeDeclaration 컨텍스트 + toLocations(밖 필터)', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'x' });
    await wait(80);
    const refs = (await mgr.request('references', { path: 'a.ts', line: 3, col: 4 })) as any[];
    expect(refs).toEqual([{ path: 'a.ts', line: 3, col: 4 }]); // outside 필터됨
    const req = servers[0].log.find((l) => l.method === 'textDocument/references')!;
    expect(req.params.context).toEqual({ includeDeclaration: true });
  });

  it('signatureHelp: toSignatureHelp 변환', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'x' });
    await wait(80);
    const sh = (await mgr.request('signatureHelp', { path: 'a.ts', line: 0, col: 5 })) as any;
    expect(sh.signatures[0].label).toBe('foo(a)');
    expect(sh.signatures[0].parameters[0].label).toBe('a');
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

  it('spec.settings가 있으면 초기화 후 workspace/didChangeConfiguration을 전송한다 (py)', async () => {
    mgr.notify('didOpen', { path: 'a.py', text: 'x = 1' });
    await wait(80);
    // pyright 스펙엔 settings 주입됨 → spawnFn이 받은 spec에도 존재
    expect(spawned[0].settings).toEqual({ python: { analysis: { typeCheckingMode: 'off' } } });
    const cfg = servers[0].log.find((l) => l.method === 'workspace/didChangeConfiguration')!;
    expect(cfg).toBeTruthy();
    expect(cfg.params.settings).toEqual({ python: { analysis: { typeCheckingMode: 'off' } } });
  });

  it('spec.settings가 없으면 didChangeConfiguration을 보내지 않는다 (ts)', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'const x = 1;' });
    await wait(80);
    expect(spawned[0].settings).toBeUndefined();
    expect(servers[0].log.find((l) => l.method === 'workspace/didChangeConfiguration')).toBeUndefined();
  });

  it('shutdownAll 후에는 exit가 재기동을 유발하지 않는다', async () => {
    mgr.notify('didOpen', { path: 'a.ts', text: 'x' });
    await wait(80);
    mgr.shutdownAll();
    servers[0].emitExit(0);
    await wait(80);
    expect(spawned).toHaveLength(1);
  });

  it('안정 실행이 crashResetMs를 넘기면 크래시 카운터가 리셋되어 3회 미달 시 계속 재기동된다', async () => {
    const resetMgr = new LspManager({
      root: '/root',
      onDiagnostics: (path, d) => diags.push({ path, count: d.length }),
      onStatus: (s) => statuses.push(s),
      crashResetMs: 100,
      spawnFn: (spec) => {
        spawned.push(spec);
        const s = makeFakeServer({ completionProvider: true, hoverProvider: true, definitionProvider: true });
        servers.push(s);
        return s.child;
      },
    });

    resetMgr.notify('didOpen', { path: 'a.ts', text: 'keep' });
    await wait(80); // 스폰 #1 running
    servers[0].emitExit(1); // 크래시 1회 (누적 1)
    await wait(80); // 재기동(#2) running
    await wait(150); // crashResetMs(100ms) 경과 → 카운터 0으로 리셋
    servers[1].emitExit(1); // 크래시 2회째 (리셋 후이므로 누적 1)
    await wait(80); // 재기동(#3) running
    servers[2].emitExit(1); // 크래시 3회째 (리셋 후 누적 2, 3회 연속 미달)
    await wait(80); // 재기동(#4) running

    expect(spawned).toHaveLength(4); // 리셋 덕에 매번 재기동
    expect(statuses.at(-1)).toEqual({ lang: 'ts', state: 'running' });
  });
});

describe('LspManager pull diagnostics', () => {
  let pullServers: FakeServer[];
  let pullSpawned: LspSpawnSpec[];
  let pullDiags: { path: string; diagnostics: any[] }[];
  let diagnosticRequestCount: number;
  let pullMgr: LspManager;

  beforeEach(() => {
    pullServers = [];
    pullSpawned = [];
    pullDiags = [];
    diagnosticRequestCount = 0;
    pullMgr = new LspManager({
      root: '/root',
      onDiagnostics: (path, d) => pullDiags.push({ path, diagnostics: d }),
      onStatus: () => {},
      spawnFn: (spec) => {
        pullSpawned.push(spec);
        const s = makeFakeServer({
          completionProvider: true,
          hoverProvider: true,
          definitionProvider: true,
          diagnosticProvider: {},
        });
        s.conn.onRequest('textDocument/diagnostic', () => {
          diagnosticRequestCount += 1;
          return {
            kind: 'full',
            items: [
              {
                message: 'pull-err',
                severity: 1,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              },
            ],
          };
        });
        pullServers.push(s);
        return s.child;
      },
    });
  });

  it('pull 진단 경로가 onDiagnostics를 호출한다', async () => {
    pullMgr.notify('didOpen', { path: 'a.ts', text: 'x' });
    await wait(400);
    expect(diagnosticRequestCount).toBeGreaterThan(0);
    const hit = pullDiags.find((d) => d.diagnostics.some((x: any) => x.message === 'pull-err'));
    expect(hit).toBeTruthy();
  });

  it('연속 didChange는 pull 요청을 디바운스로 병합한다', async () => {
    pullMgr.notify('didOpen', { path: 'a.ts', text: 'x' });
    await wait(80); // 스폰 + didOpen 정착
    pullMgr.notify('didChange', { path: 'a.ts', text: 'x1' });
    await wait(30);
    pullMgr.notify('didChange', { path: 'a.ts', text: 'x2' });
    await wait(30);
    pullMgr.notify('didChange', { path: 'a.ts', text: 'x3' });
    await wait(400);
    expect(diagnosticRequestCount).toBeLessThanOrEqual(2); // didOpen분 포함 병합 확인
  });
});
