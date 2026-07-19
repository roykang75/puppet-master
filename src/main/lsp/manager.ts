// 언어 서버 수명 관리 — 지연 기동/크래시 재시작/프로젝트 전환 종료. 스폰 주입으로 테스트 가능.
import { spawn } from 'child_process';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { LspClient } from './client';
import { serverForExt, LspSpawnSpec } from './servers';
import { toCompletionItems, toHover, toLocations, toDiagnostics, toSignatureHelp, toTextEdits } from './convert';
import { LSP_EXT_TO_LANGUAGE } from '../../shared/protocol';
import type { LspCallParams, LspDiagnosticN, LspLanguage, LspStatusN } from '../../shared/protocol';

export type LspRequestKind = 'completion' | 'hover' | 'definition' | 'references' | 'signatureHelp';

export interface ChildLike {
  stdout: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  on(event: 'exit', cb: (code: number | null) => void): void;
  kill(): void;
}

export interface LspManagerDeps {
  root: string;
  onDiagnostics(relPath: string, diagnostics: LspDiagnosticN[]): void;
  onStatus(status: LspStatusN): void;
  spawnFn?: (spec: LspSpawnSpec) => ChildLike;
  /** 서버가 이 기간(ms) 동안 안정적으로 실행되면 crashes를 0으로 리셋. 기본 60_000 */
  crashResetMs?: number;
}

interface OpenDoc { text: string; version: number; languageId: string }

interface Entry {
  client: LspClient;
  proc: ChildLike;
  ready: Promise<void>;
  crashes: number;
  openDocs: Map<string, OpenDoc>;
  pullTimers: Map<string, ReturnType<typeof setTimeout>>;
  shuttingDown: boolean;
  stableTimer?: ReturnType<typeof setTimeout>;
}

const MAX_CRASHES = 3;
const DEFAULT_CRASH_RESET_MS = 60_000;
const PULL_DEBOUNCE_MS = 300;
const TIMEOUT_MS: Record<LspRequestKind, number> = {
  completion: 5_000, hover: 5_000, definition: 1_500, references: 5_000, signatureHelp: 2_000,
};
const LSP_METHOD: Record<LspRequestKind, string> = {
  completion: 'textDocument/completion',
  hover: 'textDocument/hover',
  definition: 'textDocument/definition',
  references: 'textDocument/references',
  signatureHelp: 'textDocument/signatureHelp',
};

export class LspManager {
  private entries = new Map<LspLanguage, Entry>();
  private disposed = false;

  constructor(private deps: LspManagerDeps) {}

  private uriFor(relPath: string): string {
    return pathToFileURL(path.join(this.deps.root, relPath)).toString();
  }

  private uriToRel = (uri: string): string | null => {
    try {
      const abs = fileURLToPath(uri);
      const rel = path.relative(this.deps.root, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
      return rel.split(path.sep).join('/');
    } catch {
      return null;
    }
  };

  private extOf(lang: LspLanguage): string {
    return lang === 'ts' ? '.ts' : '.py';
  }

  private ensure(relPath: string): Entry | null {
    if (this.disposed) return null;
    const ext = path.extname(relPath).toLowerCase();
    const def = serverForExt(ext);
    if (!def) return null;
    const existing = this.entries.get(def.lang);
    if (existing) return existing.crashes >= MAX_CRASHES ? null : existing;
    return this.spawnEntry(def.lang, 0);
  }

  private spawnEntry(lang: LspLanguage, crashes: number): Entry | null {
    const def = serverForExt(this.extOf(lang))!;
    let proc: ChildLike;
    let spec: LspSpawnSpec;
    try {
      spec = def.resolveSpawn();
      proc = this.deps.spawnFn
        ? this.deps.spawnFn(spec)
        : (spawn(spec.command, spec.args, { env: spec.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as ChildLike);
    } catch {
      this.deps.onStatus({ lang, state: 'stopped' });
      return null;
    }
    this.deps.onStatus({ lang, state: 'starting' });
    const client = new LspClient(proc.stdout, proc.stdin, {
      rootUri: pathToFileURL(this.deps.root).toString(),
      onDiagnostics: (uri, raw) => {
        const rel = this.uriToRel(uri);
        if (rel != null) this.deps.onDiagnostics(rel, toDiagnostics(raw));
      },
      initializationOptions: spec.initializationOptions,
      settings: spec.settings,
    });
    const entry: Entry = {
      client,
      proc,
      crashes,
      openDocs: new Map(),
      pullTimers: new Map(),
      shuttingDown: false,
      ready: client
        .initialize()
        .then(() => {
          this.deps.onStatus({ lang, state: 'running' });
          // 초기 워크스페이스 설정 push (pyright typeCheckingMode off 등)
          if (spec.settings) client.didChangeConfiguration(spec.settings);
          // 안정 타이머: 이 기간 동안 크래시 없이 실행되면 카운터 리셋 ("연속 N회" 의미 구현)
          entry.stableTimer = setTimeout(() => {
            entry.crashes = 0;
          }, this.deps.crashResetMs ?? DEFAULT_CRASH_RESET_MS);
        })
        .catch(() => this.deps.onStatus({ lang, state: 'stopped' })),
    };
    proc.on('exit', () => {
      if (entry.stableTimer) clearTimeout(entry.stableTimer);
      if (entry.shuttingDown || this.disposed) return;
      entry.client.dispose();
      for (const t of entry.pullTimers.values()) clearTimeout(t);
      entry.pullTimers.clear();
      const nextCrashes = entry.crashes + 1;
      this.entries.delete(lang);
      if (nextCrashes >= MAX_CRASHES) {
        this.deps.onStatus({ lang, state: 'stopped' });
        // 비활성 마킹: crashes 한도를 넘긴 빈 엔트리를 남겨 ensure가 null을 돌려주게 한다
        this.entries.set(lang, { ...entry, crashes: nextCrashes });
        return;
      }
      const revived = this.spawnEntry(lang, nextCrashes);
      if (revived) {
        // 열린 문서 재전송
        for (const [rel, doc] of entry.openDocs) {
          revived.openDocs.set(rel, doc);
          void revived.ready.then(() => {
            revived.client.didOpen(this.uriFor(rel), doc.languageId, doc.text, doc.version);
            this.schedulePull(revived, rel);
          });
        }
      }
    });
    this.entries.set(lang, entry);
    return entry;
  }

  private schedulePull(entry: Entry, relPath: string): void {
    const prev = entry.pullTimers.get(relPath);
    if (prev) clearTimeout(prev);
    entry.pullTimers.set(
      relPath,
      setTimeout(() => {
        void entry.ready.then(() => entry.client.pullDiagnostics(this.uriFor(relPath)));
      }, PULL_DEBOUNCE_MS),
    );
  }

  notify(kind: 'didOpen' | 'didChange' | 'didClose' | 'didSave', params: { path: string; text?: string }): void {
    const entry = this.ensure(params.path);
    if (!entry) return;
    const uri = this.uriFor(params.path);
    void entry.ready.then(() => {
      if (kind === 'didOpen') {
        const ext = path.extname(params.path).toLowerCase();
        const languageId = LSP_EXT_TO_LANGUAGE[ext] ?? 'plaintext';
        const doc: OpenDoc = { text: params.text ?? '', version: 1, languageId };
        entry.openDocs.set(params.path, doc);
        entry.client.didOpen(uri, languageId, doc.text, 1);
        this.schedulePull(entry, params.path);
      } else if (kind === 'didChange') {
        const doc = entry.openDocs.get(params.path);
        if (!doc) return;
        doc.text = params.text ?? doc.text;
        doc.version += 1;
        entry.client.didChange(uri, doc.text, doc.version);
        this.schedulePull(entry, params.path);
      } else if (kind === 'didClose') {
        entry.openDocs.delete(params.path);
        const pullTimer = entry.pullTimers.get(params.path);
        if (pullTimer) {
          clearTimeout(pullTimer);
          entry.pullTimers.delete(params.path);
        }
        entry.client.didClose(uri);
      } else {
        entry.client.didSave(uri);
      }
    });
  }

  async request(kind: LspRequestKind, params: LspCallParams): Promise<unknown> {
    const entry = this.ensure(params.path);
    if (!entry) return null;
    await entry.ready;
    const raw = await entry.client.request(
      LSP_METHOD[kind],
      {
        textDocument: { uri: this.uriFor(params.path) },
        position: { line: params.line, character: params.col },
        ...(kind === 'completion' ? { context: { triggerKind: 1 } } : {}),
        ...(kind === 'references' ? { context: { includeDeclaration: true } } : {}),
      },
      TIMEOUT_MS[kind],
    );
    if (raw == null) return null;
    if (kind === 'completion') return toCompletionItems(raw);
    if (kind === 'hover') return toHover(raw);
    if (kind === 'signatureHelp') return toSignatureHelp(raw);
    return toLocations(raw, this.uriToRel); // definition | references
  }

  /** 문서 전체 포매팅 — TextEdit[] 반환. 서버 미지원(pyright 등) 시 빈 배열. */
  async format(params: { path: string; tabSize: number; insertSpaces: boolean }): Promise<import('../../shared/protocol').LspTextEditN[]> {
    const entry = this.ensure(params.path);
    if (!entry) return [];
    await entry.ready;
    const raw = await entry.client.request(
      'textDocument/formatting',
      {
        textDocument: { uri: this.uriFor(params.path) },
        options: { tabSize: params.tabSize, insertSpaces: params.insertSpaces },
      },
      5_000,
    );
    return raw == null ? [] : toTextEdits(raw);
  }

  shutdownAll(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.shuttingDown = true;
      if (entry.stableTimer) clearTimeout(entry.stableTimer);
      for (const t of entry.pullTimers.values()) clearTimeout(t);
      entry.client.dispose();
      try {
        entry.proc.kill();
      } catch {
        // 이미 종료
      }
    }
    this.entries.clear();
  }
}
