// LSP 프로토콜 코어 — 스트림 주입으로 테스트 가능. 프로세스 스폰은 manager 소관.
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  MessageConnection,
} from 'vscode-jsonrpc/node';

export interface LspClientOpts {
  rootUri: string;
  onDiagnostics(uri: string, diagnostics: unknown[]): void;
  initializationOptions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export class LspClient {
  private conn: MessageConnection;
  private capabilities: Record<string, unknown> = {};
  private disposed = false;

  constructor(
    input: NodeJS.ReadableStream,
    output: NodeJS.WritableStream,
    private opts: LspClientOpts,
  ) {
    this.conn = createMessageConnection(new StreamMessageReader(input), new StreamMessageWriter(output));
    this.conn.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: unknown[] }) => {
      this.opts.onDiagnostics(p.uri, p.diagnostics ?? []);
    });
    this.conn.onError(() => {}); // 연결 오류는 manager의 프로세스 exit 처리로 수렴
    // 방어: 서버가 pull(workspace/configuration)로 설정을 요청해도 죽지 않게 — 주입받은
    // settings에서 각 item.section을 dot-path로 찾아 반환(없으면 null).
    this.conn.onRequest('workspace/configuration', (p: { items?: { section?: string }[] }) =>
      (p.items ?? []).map((item) => this.configSection(item.section)),
    );
    this.conn.listen();
  }

  // settings에서 "python.analysis" 같은 dot-path 섹션을 조회. 없으면 null.
  private configSection(section: string | undefined): unknown {
    if (!section) return this.opts.settings ?? null;
    let cur: unknown = this.opts.settings;
    for (const key of section.split('.')) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur ?? null;
  }

  async initialize(): Promise<void> {
    const result = (await this.conn.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.opts.rootUri,
      initializationOptions: this.opts.initializationOptions,
      workspaceFolders: [{ uri: this.opts.rootUri, name: 'workspace' }],
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          diagnostic: {},
        },
      },
    })) as { capabilities?: Record<string, unknown> };
    this.capabilities = result?.capabilities ?? {};
    await this.conn.sendNotification('initialized', {});
  }

  // push 방식 설정 전달 — 서버가 pull(workspace/configuration)을 안 해도 초기 설정을 반영시킨다.
  didChangeConfiguration(settings: Record<string, unknown>): void {
    void this.conn.sendNotification('workspace/didChangeConfiguration', { settings });
  }

  supportsPullDiagnostics(): boolean {
    return this.capabilities.diagnosticProvider != null;
  }

  didOpen(uri: string, languageId: string, text: string, version: number): void {
    void this.conn.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text },
    });
  }

  didChange(uri: string, text: string, version: number): void {
    void this.conn.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }], // Full sync (스펙 §4)
    });
  }

  didClose(uri: string): void {
    void this.conn.sendNotification('textDocument/didClose', { textDocument: { uri } });
  }

  didSave(uri: string): void {
    void this.conn.sendNotification('textDocument/didSave', { textDocument: { uri } });
  }

  // 타임아웃/오류 시 null — 기능별 조용한 실패 (스펙 §6)
  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.disposed) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.conn.sendRequest(method, params),
        new Promise<null>((res) => {
          timer = setTimeout(() => res(null), timeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async pullDiagnostics(uri: string): Promise<void> {
    if (!this.supportsPullDiagnostics()) return;
    const res = (await this.request('textDocument/diagnostic', { textDocument: { uri } }, 5_000)) as {
      items?: unknown[];
    } | null;
    if (res?.items) this.opts.onDiagnostics(uri, res.items);
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.conn.dispose();
    } catch {
      // 이미 닫힘
    }
  }
}
