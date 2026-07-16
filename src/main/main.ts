import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { spawnIndexer, IndexerManager } from './indexer-manager';
import { ProjectFiles } from './files';
import { Persistence } from './persistence';
import { buildMenu, MenuAction } from './menu';
import { applyRenameToContent } from './rename';
import type { UiState, RenameFileGroup, RenameApplyResult } from '../shared/protocol';

if (process.env.SI_USER_DATA) app.setPath('userData', process.env.SI_USER_DATA);

const INDEXER_CALL_ALLOWED = new Set([
  'resolve', 'getReferences', 'getSuperclasses', 'getSubclasses',
  'searchSymbols', 'searchText', 'getCallers', 'getCallees', 'getRenameTargets',
]);

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

let win: BrowserWindow | null = null;
let indexer: IndexerManager | null = null;
let files: ProjectFiles | null = null;
let currentRoot: string | null = null;
let quitting = false;
let persistence: Persistence;

const sendMenu = (action: MenuAction) => win?.webContents.send('menu', action);
const sendIndexerEvent = (event: string, payload: unknown) =>
  win?.webContents.send('indexer:event', { event, payload });

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
  ipcMain.handle('file:read', (_e, rel: string) => requireFiles().readFile(rel));
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
  ipcMain.handle('bookmarks:load', () => (currentRoot ? persistence.loadBookmarks(currentRoot) : []));
  ipcMain.handle('bookmarks:save', (_e, list: unknown[]) => {
    if (currentRoot) persistence.saveBookmarks(currentRoot, list);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1e1f22',
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
});
