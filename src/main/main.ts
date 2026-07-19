import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawnIndexer, IndexerManager } from './indexer-manager';
import { ProjectFiles } from './files';
import { Persistence } from './persistence';
import { SettingsStore } from './settings';
import { CompletionService } from './completion/service';
import { ChatService } from './chat/service';
import { AgentService } from './agent/service';
import { ChatStore } from './chat-store';
import { LspManager } from './lsp/manager';
import { TerminalManager } from './terminal/manager';
import { buildMenu, MenuAction } from './menu';
import { applyRenameToContent } from './rename';
import { getFileChanges } from './git-diff';
import { detectStack } from './stack/detect';
import { buildStackSummary } from '../shared/stack-summary';
import { Context7Service } from './context7/service';
import type { UiState, LayoutPresets, RenameFileGroup, RenameApplyResult, CompletionContext, CompletionProfileInput, LspCallParams, ChatMessage, ChatContext, AgentEvent, ChatStoredMessage, ProjectStack } from '../shared/protocol';
import type { SymbolHit } from '../indexer/api';

if (process.env.SI_USER_DATA) app.setPath('userData', process.env.SI_USER_DATA);

const INDEXER_CALL_ALLOWED = new Set([
  'resolve', 'getReferences', 'getSuperclasses', 'getSubclasses',
  'searchSymbols', 'searchText', 'getCallers', 'getCallees', 'getRenameTargets',
  'getFileTokens',
]);

const LSP_CALL_ALLOWED = new Set(['completion', 'hover', 'definition', 'references', 'signatureHelp']);
const LSP_NOTIFY_ALLOWED = new Set(['didOpen', 'didChange', 'didClose', 'didSave']);

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

let win: BrowserWindow | null = null;
let indexer: IndexerManager | null = null;
let lsp: LspManager | null = null;
let terminals: TerminalManager | null = null;
let files: ProjectFiles | null = null;
let currentRoot: string | null = null;
let currentStack: ProjectStack | null = null;
let quitting = false;
let persistence: Persistence;
let settingsStore: SettingsStore;
let completionService: CompletionService;
let chatService: ChatService;
let chatStore: ChatStore | null = null;
let agentService: AgentService;

const sendMenu = (action: MenuAction) => win?.webContents.send('menu', action);
const sendIndexerEvent = (event: string, payload: unknown) => {
  // 파일 재인덱싱 완료 시 해당 path의 아웃라인 캐시 무효화 (다음 완성 요청이 최신 시그니처 반영)
  if (event === 'fileIndexed') {
    const p = (payload as { path?: unknown })?.path;
    if (typeof p === 'string') completionService?.invalidateOutline(p);
  }
  win?.webContents.send('indexer:event', { event, payload });
};

async function openProjectInMain(root: string): Promise<{ root: string; uiState: UiState | null }> {
  root = path.resolve(root); // 정규화 — Persistence가 원본 문자열을 해시하므로 상대경로가 상태를 분기시키는 것을 방지
  indexer?.kill();
  const mgr = spawnIndexer();
  indexer = mgr;
  try {
    mgr.onExit((code) => {
      if (quitting || mgr !== indexer || !win) return; // 교체/종료 중이면 무시
      void dialog
        .showMessageBox(win, {
          type: 'error',
          message: `인덱서 프로세스가 비정상 종료되었습니다 (code ${code}).`,
          buttons: ['재시작', '무시'],
        })
        .then((r) => {
          if (r.response === 0 && currentRoot) void openProjectInMain(currentRoot);
        });
    });
    mgr.rpc.onEvent(sendIndexerEvent);
    await mgr.whenReady;

    files = new ProjectFiles(root);
    currentRoot = root;
    // 스택 감지 (로컬 파싱만 — 네트워크 X, 실패해도 열기 성공)
    try {
      const CANDS = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts'];
      const manifest = CANDS
        .map((n) => ({ p: path.join(root, n), n }))
        .filter((c) => fs.existsSync(c.p))
        .map((c) => ({ path: c.n, content: fs.readFileSync(c.p, 'utf8') }));
      // 언어 감지용 소스 확장자 표본 — 루트 파일 목록만(재귀 없음, 값싸게)
      const sample = fs.readdirSync(root).map((n) => ({ path: n, content: '' }));
      currentStack = detectStack([...manifest, ...sample]);
    } catch {
      currentStack = null;
    }
    completionService?.clearOutlineCache(); // 프로젝트 전환 — rel path 충돌 방지
    lsp?.shutdownAll();
    lsp = new LspManager({
      root,
      onDiagnostics: (path, diagnostics) =>
        win?.webContents.send('lsp:event', { event: 'diagnostics', payload: { path, diagnostics } }),
      onStatus: (status) => win?.webContents.send('lsp:event', { event: 'status', payload: status }),
    });
    terminals?.killAll();
    agentService?.cancel(); // 진행 중 에이전트 루프 중단 — 이전 프로젝트에 쓰기 방지
    chatStore?.close();
    const chatDbPath = persistence.chatDbPathFor(root);
    fs.mkdirSync(path.dirname(chatDbPath), { recursive: true });
    chatStore = new ChatStore(chatDbPath);
    terminals = new TerminalManager({
      cwd: root,
      onData: (id, data) => win?.webContents.send('terminal:event', { type: 'data', id, data }),
      onExit: (id) => win?.webContents.send('terminal:event', { type: 'exit', id }),
    });
    persistence.addRecent(root);
    buildMenu(persistence.loadRecent(), sendMenu);

    // 인덱싱은 백그라운드로 — 파일 열람/편집은 즉시 가능 (스펙 §5)
    mgr.rpc
      .request('openProject', { root, dbPath: persistence.dbPathFor(root) }, { timeoutMs: 180_000 })
      .then((stats) => {
        sendIndexerEvent('indexDone', stats);
        if (process.env.SI_SMOKE === '1') {
          console.log('[smoke]', JSON.stringify(stats));
          app.quit();
        }
      })
      .catch((err: Error) => sendIndexerEvent('indexError', { message: err.message }));

    return { root, uiState: persistence.loadUiState(root) };
  } catch (err) {
    // 실패 시 방금 띄운 host를 정리해 분열 상태 방지 — 다음 열기가 fresh spawn
    if (indexer === mgr) indexer = null;
    mgr.kill();
    throw err;
  }
}

function requireFiles(): ProjectFiles {
  if (!files) throw new Error('프로젝트가 열려 있지 않습니다');
  return files;
}

function registerIpc(): void {
  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('project:open', async (_e, root: string) => {
    try {
      return await openProjectInMain(root);
    } catch (err) {
      // 프로토콜 버전 불일치 등 — 명시적 다이얼로그 (스펙 §6)
      dialog.showErrorBox('프로젝트 열기 실패', err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
  ipcMain.handle('project:recent', () => persistence.loadRecent());
  ipcMain.handle('file:list', (_e, relDir: string) => requireFiles().listDir(relDir));
  // 생성 실패(중복 등)는 {error}로 반환 — 렌더러가 인라인으로 표시
  ipcMain.handle('file:create', (_e, rel: string) => {
    try {
      requireFiles().createFile(rel);
      return null;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
  // 마크다운 링크 클릭 — http(s)만 기본 브라우저로
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle('file:mkdir', (_e, rel: string) => {
    try {
      requireFiles().createDir(rel);
      return null;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('file:read', (_e, rel: string) => requireFiles().readFile(rel));
  ipcMain.handle('file:read-binary', (_e, rel: string) => requireFiles().readBinary(rel));
  ipcMain.handle('git:fileDiff', (_e, rel: string) => (currentRoot ? getFileChanges(currentRoot, rel) : []));
  ipcMain.handle('dir:compare', (_e, leftRel: string, rightRel: string) => requireFiles().compareDirs(leftRel, rightRel));
  ipcMain.handle('file:exportHtml', async (_e, defaultName: string, content: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [{ name: 'HTML', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, content, 'utf8'); // 사용자가 다이얼로그로 고른 경로 — 루트 제한 밖 허용
    return r.filePath;
  });
  ipcMain.handle('file:save', (_e, rel: string, content: string) => {
    try {
      requireFiles().saveFile(rel, content);
    } catch (err) {
      // 저장 실패(권한 등) → 다이얼로그, 렌더러는 dirty 유지 (스펙 §6)
      dialog.showErrorBox('저장 실패', err instanceof Error ? err.message : String(err));
      throw err;
    }
    // 저장 후 재인덱싱 — 실패해도 저장 자체는 성공이므로 로그만
    indexer?.rpc.request('indexFile', { path: rel }, { timeoutMs: 180_000 }).catch((err: Error) => {
      console.error('[indexFile]', rel, err.message);
    });
  });
  ipcMain.handle('indexer:indexBuffer', (_e, rel: string, content: string) => {
    if (!indexer) return { indexed: false }; // 인덱서 없으면 조용히 무시 (편집은 계속 가능)
    return indexer.rpc.request('indexBuffer', { path: rel, content }, { timeoutMs: 180_000 });
  });
  ipcMain.handle('indexer:getFileOutline', (_e, rel: string) => {
    if (!indexer) throw new Error('인덱서가 실행 중이 아닙니다');
    // 초기 인덱싱 큐잉 대비 — indexDone 후 요청이 원칙이나 대형 프로젝트 여유
    return indexer.rpc.request('getFileOutline', { path: rel }, { timeoutMs: 180_000 });
  });
  ipcMain.handle('indexer:call', (_e, method: string, params: unknown) => {
    if (!INDEXER_CALL_ALLOWED.has(method)) throw new Error(`허용되지 않은 메서드: ${method}`);
    if (!indexer) throw new Error('인덱서가 실행 중이 아닙니다');
    return indexer.rpc.request(method, params, { timeoutMs: 180_000 });
  });
  ipcMain.handle('terminal:spawn', () =>
    terminals ? terminals.spawn() : { error: '프로젝트가 열려 있지 않습니다' },
  );
  ipcMain.handle('terminal:input', (_e, id: number, data: string) => terminals?.input(id, data));
  ipcMain.handle('terminal:resize', (_e, id: number, cols: number, rows: number) =>
    terminals?.resize(id, cols, rows),
  );
  ipcMain.handle('terminal:kill', (_e, id: number) => terminals?.kill(id));
  ipcMain.handle('lsp:call', (_e, method: string, params: unknown) => {
    if (!LSP_CALL_ALLOWED.has(method)) throw new Error(`허용되지 않은 LSP 메서드: ${method}`);
    return lsp?.request(method as 'completion' | 'hover' | 'definition' | 'references' | 'signatureHelp', params as LspCallParams) ?? null;
  });
  ipcMain.handle('lsp:notify', (_e, kind: string, params: unknown) => {
    if (!LSP_NOTIFY_ALLOWED.has(kind)) throw new Error(`허용되지 않은 LSP 통지: ${kind}`);
    lsp?.notify(kind as 'didOpen' | 'didChange' | 'didClose' | 'didSave', params as { path: string; text?: string });
  });
  ipcMain.handle(
    'rename:apply',
    (_e, oldName: string, newName: string, targets: RenameFileGroup[]): RenameApplyResult => {
      const f = requireFiles();
      // UI가 이미 검증하지만 main도 방어적으로 식별자 재검증
      if (!IDENT_RE.test(newName)) throw new Error(`유효하지 않은 식별자: ${newName}`);
      let changedFiles = 0;
      let replaced = 0;
      const skipped: RenameApplyResult['skipped'] = [];
      for (const group of targets) {
        let content: string;
        try {
          content = f.readFile(group.path);
        } catch {
          // 읽기 실패 → 이 파일의 모든 대상 위치를 skip 처리하고 계속
          for (const o of group.occurrences) skipped.push({ path: group.path, line: o.line, col: o.col });
          continue;
        }
        const r = applyRenameToContent(content, group.occurrences, oldName, newName);
        for (const s of r.skipped) skipped.push({ path: group.path, line: s.line, col: s.col });
        if (r.replaced === 0) continue;
        try {
          f.saveFile(group.path, r.content);
        } catch {
          // 쓰기 실패 → 치환됐던(=r.skipped 아닌) 위치를 skip으로 보고, 계속 진행
          const skipSet = new Set(r.skipped.map((s) => `${s.line}:${s.col}`));
          for (const o of group.occurrences) {
            if (!skipSet.has(`${o.line}:${o.col}`)) skipped.push({ path: group.path, line: o.line, col: o.col });
          }
          continue;
        }
        changedFiles++;
        replaced += r.replaced;
        // 변경 파일마다 재인덱싱 (비동기, 실패해도 로그만) — file:save 핸들러 패턴
        indexer?.rpc.request('indexFile', { path: group.path }, { timeoutMs: 180_000 }).catch((err: Error) => {
          console.error('[rename indexFile]', group.path, err.message);
        });
      }
      return { changedFiles, replaced, skipped };
    },
  );
  ipcMain.handle('ui:saveState', (_e, state: UiState) => {
    if (currentRoot) persistence.saveUiState(currentRoot, state);
  });
  ipcMain.handle('layout:presetsGet', () => persistence.loadLayoutPresets());
  ipcMain.handle('layout:presetsSave', (_e, presets: LayoutPresets) => persistence.saveLayoutPresets(presets));
  ipcMain.handle('bookmarks:load', () => (currentRoot ? persistence.loadBookmarks(currentRoot) : []));
  ipcMain.handle('bookmarks:save', (_e, list: unknown[]) => {
    if (currentRoot) persistence.saveBookmarks(currentRoot, list);
  });
  ipcMain.handle('settings:completion:get', () => settingsStore.toPublic());
  ipcMain.handle(
    'settings:completion:set',
    (_e, profiles: CompletionProfileInput[], activeIndex: number | null) => {
      // throw는 그대로 렌더러로 전파 — 오버레이가 오류를 표시한다 (파일 쓰기 실패 등)
      settingsStore.setProfiles(profiles, activeIndex);
      completionService.invalidateAdapter(); // 설정/키 변경 반영 — 다음 요청이 새 어댑터 생성
    },
  );
  ipcMain.handle('settings:completion:set-active', (_e, id: string | null) => {
    settingsStore.setActiveProfile(id);
    completionService.invalidateAdapter(); // 완성도 같은 활성 프로파일을 따른다
  });
  ipcMain.handle('completion:request', (_e, ctx: CompletionContext) => completionService.request(ctx));
  ipcMain.handle('chat:send', (_e, messages: ChatMessage[], context: ChatContext | null) => {
    // fire-and-forget — 이벤트는 chat:event push로 전달 (스트리밍 동안 invoke를 붙잡지 않음)
    void chatService.send(messages, context, (event) => win?.webContents.send('chat:event', event));
  });
  ipcMain.handle('chat:cancel', () => chatService.cancel());
  ipcMain.handle('chat:threads:list', () => chatStore?.listThreads() ?? []);
  ipcMain.handle('chat:threads:search', (_e, query: string) => chatStore?.searchMessages(query) ?? []);
  ipcMain.handle('chat:thread:load', (_e, id: string) => chatStore?.loadThread(id) ?? []);
  ipcMain.handle('chat:thread:create', (_e, title: string) => ({ id: chatStore?.createThread(title) ?? '' }));
  ipcMain.handle('chat:thread:save', (_e, id: string, title: string, messages: ChatStoredMessage[]) => {
    try {
      chatStore?.saveThread(id, title, messages);
    } catch (e) {
      console.error('[chat-store] save 실패:', e instanceof Error ? e.message : e); // 채팅 흐름 무영향
    }
  });
  ipcMain.handle('chat:thread:rename', (_e, id: string, title: string) => chatStore?.renameThread(id, title));
  ipcMain.handle('chat:thread:delete', (_e, id: string) => chatStore?.deleteThread(id));
  ipcMain.handle('agent:send', (_e, messages: ChatMessage[], context: ChatContext | null, autoApprove: boolean, readOnly = false) => {
    void agentService.send(messages, context, autoApprove, (event) => win?.webContents.send('agent:event', event), readOnly);
  });
  ipcMain.handle('agent:cancel', () => agentService.cancel());
  ipcMain.handle('agent:approve', (_e, id: string, ok: boolean) => agentService.approve(id, ok));
  ipcMain.handle('tm:onigWasm', () => {
    const dir = path.dirname(require.resolve('vscode-oniguruma'));
    return fs.readFileSync(path.join(dir, 'onig.wasm')); // Buffer → 렌더러에서 ArrayBuffer
  });
  ipcMain.handle('snippets:read', (_e, lang: string) => {
    if (!/^[a-z]+$/.test(lang)) return null; // 경로 주입 방어
    const p = path.join(app.getPath('userData'), 'snippets', `${lang}.json`);
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null; // 없음/손상 → 번들만 사용
    }
  });
  ipcMain.handle('settings:appearance:get', () => settingsStore.getAppearance());
  ipcMain.handle('settings:appearance:set', (_e, a: { theme: string }) => settingsStore.setAppearance(a));
  ipcMain.handle('settings:agent:get', () => settingsStore.getAgent());
  ipcMain.handle('settings:agent:set', (_e, a: { allowedDirs: string[] }) => settingsStore.setAgent(a));
  ipcMain.handle('settings:context7:set-key', (_e, key: string) => settingsStore.setContext7Key(key));
  ipcMain.handle('stack:get', () => (currentStack ? buildStackSummary(currentStack) : null));

  const themesDir = () => path.join(app.getPath('userData'), 'themes');
  ipcMain.handle('theme:list', () => {
    try {
      return fs.readdirSync(themesDir())
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const id = `user:${f.slice(0, -5)}`;
          try {
            const name = (JSON.parse(fs.readFileSync(path.join(themesDir(), f), 'utf8')) as { name?: string }).name;
            return { id, name: name || f.slice(0, -5) };
          } catch {
            return { id, name: f.slice(0, -5) };
          }
        });
    } catch {
      return []; // 폴더 없음
    }
  });
  ipcMain.handle('theme:read', (_e, id: string) => {
    if (!id.startsWith('user:') || id.includes('..') || id.includes('/')) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(themesDir(), `${id.slice(5)}.json`), 'utf8'));
    } catch {
      return null;
    }
  });
  ipcMain.handle('theme:import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'VS Code 테마', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) as { name?: string; colors?: unknown; tokenColors?: unknown };
      if (!raw.tokenColors && !raw.colors) return { error: 'VS Code 테마 형식이 아닙니다 (colors/tokenColors 없음)' };
      fs.mkdirSync(themesDir(), { recursive: true });
      const base = path.basename(r.filePaths[0], '.json').replace(/[^\w-]/g, '_');
      fs.writeFileSync(path.join(themesDir(), `${base}.json`), JSON.stringify(raw));
      return { id: `user:${base}`, name: raw.name || base };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('snippets:openFolder', async () => {
    const dir = path.join(app.getPath('userData'), 'snippets');
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1e1f22',
    // 네이티브 타이틀바는 앱 테마를 따르지 못한다 — 숨기고 렌더러가 캡션바(.caption-bar)를 그린다.
    // 신호등 버튼은 남으므로 위치만 36px 바에 맞춰 조정.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 11 },
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js') },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  persistence = new Persistence(app.getPath('userData'));
  settingsStore = new SettingsStore(app.getPath('userData'));
  completionService = new CompletionService({
    getSettings: () => settingsStore.getCompletion(),
    getApiKey: () => settingsStore.getApiKey(),
    getOutline: async (p: string): Promise<SymbolHit[]> => {
      if (!indexer) throw new Error('인덱서가 실행 중이 아닙니다');
      return indexer.rpc.request('getFileOutline', { path: p }, { timeoutMs: 5_000 }) as Promise<SymbolHit[]>;
    },
  });
  chatService = new ChatService({
    getSettings: () => settingsStore.getCompletion(),
    getApiKey: () => settingsStore.getApiKey(),
  });
  const context7 = new Context7Service({ getApiKey: () => settingsStore.getContext7Key() });
  agentService = new AgentService({
    getSettings: () => settingsStore.getCompletion(),
    getApiKey: () => settingsStore.getApiKey(),
    getToolDeps: () =>
      currentRoot
        ? {
            projectRoot: currentRoot,
            allowedDirs: settingsStore.getAgent().allowedDirs,
            searchText: async (query: string) =>
              indexer
                ? ((await indexer.rpc.request('searchText', { query }, { timeoutMs: 30_000 })) as { path: string; snippet: string }[])
                : [],
            libraryDocs: (library: string, query: string) => context7.libraryDocs(library, query),
          }
        : null,
  });
  createWindow();
  buildMenu(persistence.loadRecent(), sendMenu);
  registerIpc();
  if (process.env.SI_OPEN_PROJECT) {
    win!.webContents.once('did-finish-load', () => {
      sendMenu({ type: 'open-recent', root: process.env.SI_OPEN_PROJECT! });
    });
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  indexer?.kill();
  lsp?.shutdownAll();
  terminals?.killAll();
  agentService?.cancel(); // 진행 중 에이전트 루프 중단 — 이전 프로젝트에 쓰기 방지
  chatStore?.close();
});
