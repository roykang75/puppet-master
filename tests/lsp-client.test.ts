import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, MessageConnection } from 'vscode-jsonrpc/node';
import { LspClient } from '../src/main/lsp/client';

let client: LspClient;
let server: MessageConnection;
let received: { method: string; params: any }[];
let diagnostics: { uri: string; diags: unknown[] }[];
let serverCaps: Record<string, unknown>;

beforeEach(() => {
  received = [];
  diagnostics = [];
  serverCaps = { completionProvider: true, hoverProvider: true, definitionProvider: true };
  const c2s = new PassThrough();
  const s2c = new PassThrough();
  server = createMessageConnection(new StreamMessageReader(c2s), new StreamMessageWriter(s2c));
  server.onRequest('initialize', (p) => {
    received.push({ method: 'initialize', params: p });
    return { capabilities: serverCaps };
  });
  server.onNotification((method, params) => received.push({ method, params }));
  server.onRequest('textDocument/completion', () => ({ items: [{ label: 'ok' }] }));
  server.onRequest('slow/method', () => new Promise((res) => setTimeout(() => res('late'), 500)));
  server.onRequest('textDocument/diagnostic', () => ({ kind: 'full', items: [{ message: 'e', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] }));
  server.listen();
  client = new LspClient(s2c, c2s, {
    rootUri: 'file:///proj',
    onDiagnostics: (uri, diags) => diagnostics.push({ uri, diags }),
  });
});
afterEach(() => {
  client.dispose();
  server.dispose();
});

describe('LspClient', () => {
  it('initialize 핸드셰이크: rootUri 전달 + initialized 통지', async () => {
    await client.initialize();
    const init = received.find((r) => r.method === 'initialize')!;
    expect(init.params.rootUri).toBe('file:///proj');
    await new Promise((r) => setTimeout(r, 50));
    expect(received.some((r) => r.method === 'initialized')).toBe(true);
  });

  it('initialize 요청에 initializationOptions가 포함된다', async () => {
    const initOpts = { tsserver: { path: '/x/tsserver.js' } };
    const c2s = new PassThrough();
    const s2c = new PassThrough();
    const srv = createMessageConnection(new StreamMessageReader(c2s), new StreamMessageWriter(s2c));
    let seen: any;
    srv.onRequest('initialize', (p) => {
      seen = p;
      return { capabilities: {} };
    });
    srv.listen();
    const c = new LspClient(s2c, c2s, {
      rootUri: 'file:///proj',
      onDiagnostics: () => {},
      initializationOptions: initOpts,
    });
    await c.initialize();
    expect(seen.initializationOptions).toEqual(initOpts);
    c.dispose();
    srv.dispose();
  });

  it('문서 수명 통지: didOpen(Full)/didChange/didClose/didSave', async () => {
    await client.initialize();
    client.didOpen('file:///proj/a.ts', 'typescript', 'abc', 1);
    client.didChange('file:///proj/a.ts', 'abcd', 2);
    client.didSave('file:///proj/a.ts');
    client.didClose('file:///proj/a.ts');
    await new Promise((r) => setTimeout(r, 50));
    const open = received.find((r) => r.method === 'textDocument/didOpen')!;
    expect(open.params.textDocument).toEqual({ uri: 'file:///proj/a.ts', languageId: 'typescript', version: 1, text: 'abc' });
    const change = received.find((r) => r.method === 'textDocument/didChange')!;
    expect(change.params.contentChanges).toEqual([{ text: 'abcd' }]); // Full sync
    expect(change.params.textDocument.version).toBe(2);
    expect(received.some((r) => r.method === 'textDocument/didSave')).toBe(true);
    expect(received.some((r) => r.method === 'textDocument/didClose')).toBe(true);
  });

  it('request: 정상 응답 반환, 타임아웃 시 null', async () => {
    await client.initialize();
    const res = await client.request('textDocument/completion', {}, 1000);
    expect((res as { items: unknown[] }).items).toHaveLength(1);
    const late = await client.request('slow/method', {}, 100);
    expect(late).toBeNull();
  });

  it('publishDiagnostics 수신 → onDiagnostics', async () => {
    await client.initialize();
    server.sendNotification('textDocument/publishDiagnostics', { uri: 'file:///proj/a.ts', diagnostics: [{ message: 'x' }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(diagnostics).toEqual([{ uri: 'file:///proj/a.ts', diags: [{ message: 'x' }] }]);
  });

  it('pull 진단: diagnosticProvider 있으면 지원 + 요청 결과를 onDiagnostics로', async () => {
    serverCaps.diagnosticProvider = {};
    await client.initialize();
    expect(client.supportsPullDiagnostics()).toBe(true);
    await client.pullDiagnostics('file:///proj/a.ts');
    expect(diagnostics[0].uri).toBe('file:///proj/a.ts');
    expect(diagnostics[0].diags).toHaveLength(1);
  });

  it('diagnosticProvider 없으면 pull 미지원 + pullDiagnostics는 no-op', async () => {
    await client.initialize();
    expect(client.supportsPullDiagnostics()).toBe(false);
    await client.pullDiagnostics('file:///proj/a.ts');
    expect(diagnostics).toHaveLength(0);
  });
});
