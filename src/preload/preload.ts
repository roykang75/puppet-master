import { contextBridge, ipcRenderer } from 'electron';
import type { UiState, RenameTargets, RenameFileGroup, RenameApplyResult, FileTokens, CompletionSettings, CompletionProfileInput, CompletionContext, CompletionResult, LspCallParams, LspDiagnosticN, LspStatusN, ChatMessage, ChatContext, ChatEvent, AgentEvent, ThreadMeta, ThreadSearchHit, ChatStoredMessage } from '../shared/protocol';
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
  createFile: (rel: string): Promise<{ error: string } | null> => ipcRenderer.invoke('file:create', rel),
  createDir: (rel: string): Promise<{ error: string } | null> => ipcRenderer.invoke('file:mkdir', rel),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  readFileBinary: (rel: string): Promise<string> => ipcRenderer.invoke('file:read-binary', rel),
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
    profiles: CompletionProfileInput[],
    activeIndex: number | null,
  ): Promise<void> => ipcRenderer.invoke('settings:completion:set', profiles, activeIndex),
  setActiveCompletionProfile: (id: string | null): Promise<void> =>
    ipcRenderer.invoke('settings:completion:set-active', id),
  requestCompletion: (ctx: CompletionContext): Promise<CompletionResult> =>
    ipcRenderer.invoke('completion:request', ctx),
  chatSend: (messages: ChatMessage[], context: ChatContext | null): Promise<void> =>
    ipcRenderer.invoke('chat:send', messages, context),
  chatCancel: (): Promise<void> => ipcRenderer.invoke('chat:cancel'),
  chatThreadsList: (): Promise<ThreadMeta[]> => ipcRenderer.invoke('chat:threads:list'),
  chatThreadsSearch: (query: string): Promise<ThreadSearchHit[]> => ipcRenderer.invoke('chat:threads:search', query),
  chatThreadLoad: (id: string): Promise<ChatStoredMessage[]> => ipcRenderer.invoke('chat:thread:load', id),
  chatThreadCreate: (title: string): Promise<{ id: string }> => ipcRenderer.invoke('chat:thread:create', title),
  chatThreadSave: (id: string, title: string, messages: ChatStoredMessage[]): Promise<void> =>
    ipcRenderer.invoke('chat:thread:save', id, title, messages),
  chatThreadRename: (id: string, title: string): Promise<void> => ipcRenderer.invoke('chat:thread:rename', id, title),
  chatThreadDelete: (id: string): Promise<void> => ipcRenderer.invoke('chat:thread:delete', id),
  onChatEvent: (cb: (e: ChatEvent) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, data: ChatEvent) => cb(data);
    ipcRenderer.on('chat:event', h);
    return () => ipcRenderer.removeListener('chat:event', h);
  },
  agentSend: (messages: ChatMessage[], context: ChatContext | null, autoApprove: boolean, readOnly = false): Promise<void> =>
    ipcRenderer.invoke('agent:send', messages, context, autoApprove, readOnly),
  agentCancel: (): Promise<void> => ipcRenderer.invoke('agent:cancel'),
  agentApprove: (id: string, ok: boolean): Promise<void> => ipcRenderer.invoke('agent:approve', id, ok),
  onAgentEvent: (cb: (e: AgentEvent) => void): void => {
    ipcRenderer.on('agent:event', (_e, ev: AgentEvent) => cb(ev));
  },
  terminalSpawn: (): Promise<{ id: number } | { error: string }> =>
    ipcRenderer.invoke('terminal:spawn'),
  terminalInput: (id: number, data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:input', id, data),
  terminalResize: (id: number, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalKill: (id: number): Promise<void> => ipcRenderer.invoke('terminal:kill', id),
  onTerminalEvent: (
    cb: (e: { type: 'data'; id: number; data: string } | { type: 'exit'; id: number }) => void,
  ): (() => void) => {
    const h = (
      _e: Electron.IpcRendererEvent,
      data: { type: 'data'; id: number; data: string } | { type: 'exit'; id: number },
    ) => cb(data);
    ipcRenderer.on('terminal:event', h);
    return () => ipcRenderer.removeListener('terminal:event', h);
  },
  snippetsRead: (lang: string): Promise<unknown | null> => ipcRenderer.invoke('snippets:read', lang),
  getAppearance: (): Promise<{ theme: string }> => ipcRenderer.invoke('settings:appearance:get'),
  setAppearance: (a: { theme: string }): Promise<void> => ipcRenderer.invoke('settings:appearance:set', a),
  getAgentSettings: (): Promise<{ allowedDirs: string[] }> => ipcRenderer.invoke('settings:agent:get'),
  setAgentSettings: (a: { allowedDirs: string[] }): Promise<void> => ipcRenderer.invoke('settings:agent:set', a),
  setContext7Key: (key: string): Promise<void> => ipcRenderer.invoke('settings:context7:set-key', key),
  getProjectStack: (): Promise<string | null> => ipcRenderer.invoke('stack:get'),
  themeList: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke('theme:list'),
  themeRead: (id: string): Promise<unknown | null> => ipcRenderer.invoke('theme:read', id),
  themeImport: (): Promise<{ id: string; name: string } | { error: string } | null> =>
    ipcRenderer.invoke('theme:import'),
  snippetsOpenFolder: (): Promise<void> => ipcRenderer.invoke('snippets:openFolder'),
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
