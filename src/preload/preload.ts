import { contextBridge, ipcRenderer } from 'electron';
import type { UiState } from '../shared/protocol';
import type { SymbolHit } from '../indexer/api';
import type { DirEntry } from '../main/files';
import type { RecentEntry } from '../main/persistence';
import type { MenuAction } from '../main/menu';

const api = {
  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  openProject: (root: string): Promise<{ root: string; uiState: UiState | null }> =>
    ipcRenderer.invoke('project:open', root),
  getRecent: (): Promise<RecentEntry[]> => ipcRenderer.invoke('project:recent'),
  listDir: (relDir: string): Promise<DirEntry[]> => ipcRenderer.invoke('file:list', relDir),
  readFile: (rel: string): Promise<string> => ipcRenderer.invoke('file:read', rel),
  saveFile: (rel: string, content: string): Promise<void> => ipcRenderer.invoke('file:save', rel, content),
  getFileOutline: (rel: string): Promise<SymbolHit[]> => ipcRenderer.invoke('indexer:getFileOutline', rel),
  saveUiState: (state: UiState): Promise<void> => ipcRenderer.invoke('ui:saveState', state),
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
