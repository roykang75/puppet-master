import { create } from 'zustand';
import type { IndexStats } from '../../indexer/pipeline';
import type { Bookmark } from './bookmarks';

export interface Tab {
  path: string;
  dirty: boolean;
  diskChanged: boolean;
}

interface AppState {
  root: string | null;
  indexing: { done: number; total: number } | null;
  stats: IndexStats | null;
  error: string | null;
  tabs: Tab[];
  activePath: string | null;
  outlineVersion: number;
  cursorSymbol: { name: string; path: string; line: number; col: number } | null;
  pendingJump: { path: string; line: number; col: number } | null;
  searchOpen: boolean;
  settingsOpen: boolean;
  renameRequest: { name: string; path: string } | null;
  completionStatus: string | null;
  lspStopped: string[]; // 중지된 LSP 언어 목록 (예: ['ts'])
  bookmarks: Bookmark[];
  chatMessages: { role: 'user' | 'assistant'; content: string; error?: string }[];
  chatStreaming: boolean;
  chatContextEnabled: boolean;
  rightTab: 'relation' | 'chat';
  setProject(root: string): void;
  setIndexing(p: { done: number; total: number } | null): void;
  setStats(s: IndexStats): void;
  setError(msg: string | null): void;
  openTab(path: string): void;
  closeTab(path: string): void;
  setActive(path: string): void;
  setDirty(path: string, dirty: boolean): void;
  markDiskChanged(path: string): void;
  bumpOutline(): void;
  setCursorSymbol(s: AppState['cursorSymbol']): void;
  setPendingJump(j: AppState['pendingJump']): void;
  setSearchOpen(v: boolean): void;
  setSettingsOpen(v: boolean): void;
  setRenameRequest(r: { name: string; path: string } | null): void;
  setCompletionStatus(msg: string | null): void;
  setLspStopped(lang: string, stopped: boolean): void;
  setBookmarks(list: Bookmark[]): void;
  appendChatUser(content: string): void;
  appendChatAssistant(): void; // 빈 어시스턴트 자리
  appendChatChunk(text: string): void; // 마지막 어시스턴트에 append
  setChatError(error: string): void; // 마지막 어시스턴트에 오류 표기
  setChatStreaming(v: boolean): void;
  setChatContextEnabled(v: boolean): void;
  setRightTab(v: 'relation' | 'chat'): void;
  clearChat(): void;
}

export const useAppStore = create<AppState>((set) => ({
  root: null,
  indexing: null,
  stats: null,
  error: null,
  tabs: [],
  activePath: null,
  outlineVersion: 0,
  cursorSymbol: null,
  pendingJump: null,
  searchOpen: false,
  settingsOpen: false, // 전역 설정 — setProject 리셋에 포함하지 않음
  renameRequest: null,
  completionStatus: null,
  lspStopped: [],
  bookmarks: [],
  chatMessages: [],
  chatStreaming: false,
  chatContextEnabled: true,
  rightTab: 'relation',
  setProject: (root) =>
    set({ root, tabs: [], activePath: null, indexing: null, stats: null, error: null, cursorSymbol: null, pendingJump: null, searchOpen: false, renameRequest: null, completionStatus: null, lspStopped: [], bookmarks: [], chatMessages: [], chatStreaming: false }),
  setIndexing: (indexing) => set({ indexing }),
  setStats: (stats) => set({ stats }),
  setError: (error) => set({ error }),
  openTab: (path) =>
    set((s) =>
      s.tabs.some((t) => t.path === path)
        ? { activePath: path }
        : { tabs: [...s.tabs, { path, dirty: false, diskChanged: false }], activePath: path },
    ),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const activePath = s.activePath === path ? (tabs[tabs.length - 1]?.path ?? null) : s.activePath;
      return { tabs, activePath };
    }),
  setActive: (path) => set({ activePath: path }),
  setDirty: (path, dirty) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty, diskChanged: dirty ? t.diskChanged : false } : t)),
    })),
  markDiskChanged: (path) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, diskChanged: true } : t)) })),
  bumpOutline: () => set((s) => ({ outlineVersion: s.outlineVersion + 1 })),
  setCursorSymbol: (cursorSymbol) => set({ cursorSymbol }),
  setPendingJump: (pendingJump) => set({ pendingJump }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setRenameRequest: (renameRequest) => set({ renameRequest }),
  setCompletionStatus: (completionStatus) => set({ completionStatus }),
  setLspStopped: (lang, stopped) =>
    set((s) => ({
      lspStopped: stopped ? [...new Set([...s.lspStopped, lang])] : s.lspStopped.filter((l) => l !== lang),
    })),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  appendChatUser: (content) => set((s) => ({ chatMessages: [...s.chatMessages, { role: 'user', content }] })),
  appendChatAssistant: () => set((s) => ({ chatMessages: [...s.chatMessages, { role: 'assistant', content: '' }] })),
  appendChatChunk: (text) =>
    set((s) => {
      const msgs = s.chatMessages.slice();
      const last = msgs.at(-1);
      if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: last.content + text };
      return { chatMessages: msgs };
    }),
  setChatError: (error) =>
    set((s) => {
      const msgs = s.chatMessages.slice();
      const last = msgs.at(-1);
      if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, error };
      return { chatMessages: msgs };
    }),
  setChatStreaming: (chatStreaming) => set({ chatStreaming }),
  setChatContextEnabled: (chatContextEnabled) => set({ chatContextEnabled }),
  setRightTab: (rightTab) => set({ rightTab }),
  clearChat: () => set({ chatMessages: [], chatStreaming: false }),
}));
