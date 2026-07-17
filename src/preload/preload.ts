import { contextBridge, ipcRenderer } from 'electron';
import type { UiState, RenameTargets, RenameFileGroup, RenameApplyResult, FileTokens, CompletionSettings, CompletionContext, CompletionResult, LspCallParams, LspDiagnosticN, LspStatusN } from '../shared/protocol';
import type { SymbolHit, TextHit, CallerHit, RefHit } from '../indexer/api';
import type { Candidate } from '../indexer/resolve';
import type { DirEntry } from '../main/files';
import type { RecentEntry } from '../main/persistence';
import type { MenuAction } from '../main/menu';

type LspEventPayload =
  | { event: 'diagnostics'; payload: { path: string; diagnostics: LspDiagnosticN[] } }
  | { event: 'status'; payload: LspStatusN };

const api = {
  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  openProject: (root: string): Promise<{ root: string; uiState: UiState | null }> =>
    ipcRenderer.invoke('project:open', root),
  getRecent: (): Promise<RecentEntry[]> => ipcRenderer.invoke('project:recent'),
  listDir: (relDir: string): Promise<DirEntry[]> => ipcRenderer.invoke('file:list', relDir),
  readFile: (rel: string): Promise<string> => ipcRenderer.invoke('file:read', rel),
  saveFile: (rel: string, content: string): Promise<void> => ipcRenderer.invoke('file:save', rel, content),
  getFileOutline: (rel: string): Promise<SymbolHit[]> => ipcRenderer.invoke('indexer:getFileOutline', rel),
  getFileTokens: (path: string): Promise<FileTokens> =>
    ipcRenderer.invoke('indexer:call', 'getFileTokens', { path }),
  indexBuffer: (rel: string, content: string): Promise<{ indexed: boolean }> =>
    ipcRenderer.invoke('indexer:indexBuffer', rel, content),
  resolve: (name: string, fromPath: string): Promise<Candidate[]> =>
    ipcRenderer.invoke('indexer:call', 'resolve', { name, fromPath }),
  getReferences: (name: string): Promise<RefHit[]> =>
    ipcRenderer.invoke('indexer:call', 'getReferences', { name }),
  getSuperclasses: (symbolId: number): Promise<SymbolHit[]> =>
    ipcRenderer.invoke('indexer:call', 'getSuperclasses', { symbolId }),
  getSubclasses: (name: string): Promise<SymbolHit[]> =>
    ipcRenderer.invoke('indexer:call', 'getSubclasses', { name }),
  searchSymbols: (query: string): Promise<SymbolHit[]> =>
    ipcRenderer.invoke('indexer:call', 'searchSymbols', { query }),
  searchText: (query: string): Promise<TextHit[]> =>
    ipcRenderer.invoke('indexer:call', 'searchText', { query }),
  getCallers: (name: string): Promise<CallerHit[]> =>
    ipcRenderer.invoke('indexer:call', 'getCallers', { name }),
  getCallees: (symbolId: number): Promise<SymbolHit[]> =>
    ipcRenderer.invoke('indexer:call', 'getCallees', { symbolId }),
  getRenameTargets: (name: string): Promise<RenameTargets> =>
    ipcRenderer.invoke('indexer:call', 'getRenameTargets', { name }),
  applyRename: (oldName: string, newName: string, targets: RenameFileGroup[]): Promise<RenameApplyResult> =>
    ipcRenderer.invoke('rename:apply', oldName, newName, targets),
  getCompletionSettings: (): Promise<CompletionSettings> => ipcRenderer.invoke('settings:completion:get'),
  setCompletionSettings: (
    s: { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string },
    apiKey?: string,
  ): Promise<void> => ipcRenderer.invoke('settings:completion:set', s, apiKey),
  requestCompletion: (ctx: CompletionContext): Promise<CompletionResult> =>
    ipcRenderer.invoke('completion:request', ctx),
  snippetsRead: (lang: string): Promise<unknown | null> => ipcRenderer.invoke('snippets:read', lang),
  onigWasm: async (): Promise<ArrayBuffer> => {
    const buf: Uint8Array = await ipcRenderer.invoke('tm:onigWasm');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  },
  saveUiState: (state: UiState): Promise<void> => ipcRenderer.invoke('ui:saveState', state),
  loadBookmarks: (): Promise<unknown[]> => ipcRenderer.invoke('bookmarks:load'),
  saveBookmarks: (list: unknown[]): Promise<void> => ipcRenderer.invoke('bookmarks:save', list),
  lspCall: (method: 'completion' | 'hover' | 'definition', params: LspCallParams): Promise<unknown> =>
    ipcRenderer.invoke('lsp:call', method, params),
  lspNotify: (kind: 'didOpen' | 'didChange' | 'didClose' | 'didSave', params: { path: string; text?: string }): Promise<void> =>
    ipcRenderer.invoke('lsp:notify', kind, params),
  onLspEvent: (cb: (e: LspEventPayload) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, data: LspEventPayload) => cb(data);
    ipcRenderer.on('lsp:event', h);
    return () => ipcRenderer.removeListener('lsp:event', h);
  },
  onIndexerEvent: (cb: (event: string, payload: unknown) => void): void => {
    ipcRenderer.on('indexer:event', (_e, msg: { event: string; payload: unknown }) => cb(msg.event, msg.payload));
  },
  onMenu: (cb: (action: MenuAction) => void): void => {
    ipcRenderer.on('menu', (_e, action: MenuAction) => cb(action));
  },
};

contextBridge.exposeInMainWorld('si', api);

export type SiApi = typeof api;
export type { MenuAction };
