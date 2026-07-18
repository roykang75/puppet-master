import { create } from 'zustand';
import type { IndexStats } from '../../indexer/pipeline';
import type { AgentToolUi } from '../../shared/protocol';
import type { Bookmark } from './bookmarks';

export interface Tab {
  path: string; // 파일 탭: 실제 경로 / diff 탭: 'diff://<실경로>' (고유 키)
  dirty: boolean;
  diskChanged: boolean;
  diff?: { path: string; before: string; after: string }; // 있으면 에이전트 변경 제안 diff 탭 (읽기 전용 가상 문서)
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
  chatMessages: { role: 'user' | 'assistant'; content: string; error?: string; ts?: number; tools?: AgentToolUi[] }[];
  chatStreaming: boolean;
  chatContextEnabled: boolean;
  agentMode: boolean;
  autoApprove: boolean;
  treeRefreshNonce: number;
  rightTab: 'relation' | 'chat';
  terminals: { id: number; title: string; exited: boolean }[];
  activeTerminalId: number | null;
  bottomTab: 'context' | 'terminal';
  // 에디터 세로 분할 / 마크다운 미리보기 (에이전트 diff는 일반 탭으로 통합됨)
  split: { kind: 'editor' | 'preview'; path: string } | null;
  setSplit(split: AppState['split']): void;
  setProject(root: string): void;
  setIndexing(p: { done: number; total: number } | null): void;
  setStats(s: IndexStats): void;
  setError(msg: string | null): void;
  openTab(path: string): void;
  openDiffTab(path: string, before: string, after: string): void; // 변경 제안 탭 열기/갱신 (키 diff://<path>)
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
  setAgentMode(v: boolean): void;
  setAutoApprove(v: boolean): void;
  upsertChatTool(tool: AgentToolUi): void;
  bumpTreeRefresh(): void;
  setRightTab(v: 'relation' | 'chat'): void;
  clearChat(): void;
  addTerminal(id: number, title: string): void;
  removeTerminal(id: number): void; // active면 남은 것 중 마지막으로 전환
  markTerminalExited(id: number): void;
  setActiveTerminalId(id: number | null): void;
  setBottomTab(v: 'context' | 'terminal'): void;
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
  agentMode: false,
  autoApprove: true,
  treeRefreshNonce: 0,
  rightTab: 'relation',
  terminals: [],
  activeTerminalId: null,
  bottomTab: 'context',
  split: null,
  setSplit: (split) => set({ split }),
  setProject: (root) =>
    set({ root, tabs: [], activePath: null, indexing: null, stats: null, error: null, cursorSymbol: null, pendingJump: null, searchOpen: false, renameRequest: null, completionStatus: null, lspStopped: [], bookmarks: [], chatMessages: [], chatStreaming: false, terminals: [], activeTerminalId: null, split: null }),
  setIndexing: (indexing) => set({ indexing }),
  setStats: (stats) => set({ stats }),
  setError: (error) => set({ error }),
  openTab: (path) =>
    set((s) =>
      s.tabs.some((t) => t.path === path)
        ? { activePath: path }
        : { tabs: [...s.tabs, { path, dirty: false, diskChanged: false }], activePath: path },
    ),
  openDiffTab: (path, before, after) =>
    set((s) => {
      const key = `diff://${path}`;
      const tab: Tab = { path: key, dirty: false, diskChanged: false, diff: { path, before, after } };
      const idx = s.tabs.findIndex((t) => t.path === key);
      const tabs = idx >= 0 ? s.tabs.map((t, i) => (i === idx ? tab : t)) : [...s.tabs, tab];
      return { tabs, activePath: key };
    }),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const activePath = s.activePath === path ? (tabs[tabs.length - 1]?.path ?? null) : s.activePath;
      // 분할 창이 보던 파일이 닫히면(모델 폐기) 분할도 닫는다
      const split = s.split?.path === path ? null : s.split;
      return { tabs, activePath, split };
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
  appendChatUser: (content) => set((s) => ({ chatMessages: [...s.chatMessages, { role: 'user', content, ts: Date.now() }] })),
  appendChatAssistant: () => set((s) => ({ chatMessages: [...s.chatMessages, { role: 'assistant', content: '', ts: Date.now() }] })),
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
  setAgentMode: (v) => set({ agentMode: v }),
  setAutoApprove: (v) => set({ autoApprove: v }),
  bumpTreeRefresh: () => set((s) => ({ treeRefreshNonce: s.treeRefreshNonce + 1 })),
  upsertChatTool: (tool) =>
    set((s) => {
      const msgs = s.chatMessages.slice();
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return {};
      const tools = (last.tools ?? []).slice();
      const idx = tools.findIndex((t) => t.id === tool.id);
      if (idx >= 0) tools[idx] = tool;
      else tools.push(tool);
      msgs[msgs.length - 1] = { ...last, tools };
      return { chatMessages: msgs };
    }),
  setRightTab: (rightTab) => set({ rightTab }),
  clearChat: () => set({ chatMessages: [], chatStreaming: false }),
  addTerminal: (id, title) =>
    set((s) => ({ terminals: [...s.terminals, { id, title, exited: false }], activeTerminalId: id })),
  removeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      const activeTerminalId =
        s.activeTerminalId === id ? (terminals.at(-1)?.id ?? null) : s.activeTerminalId;
      return { terminals, activeTerminalId };
    }),
  markTerminalExited: (id) =>
    set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, exited: true } : t)) })),
  setActiveTerminalId: (activeTerminalId) => set({ activeTerminalId }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
}));
