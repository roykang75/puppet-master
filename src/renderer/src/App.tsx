import { useEffect, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout, useGroupRef } from 'react-resizable-panels';
import { registerLayoutGroup } from './layout-presets';
import { useAppStore } from './store';
import { initLayouts, layoutStorage, scheduleSave } from './persistence-bridge';
import { EmptyState } from './components/EmptyState';
import { StatusBar } from './components/StatusBar';
import { RightPanel } from './components/RightPanel';
import { BottomPanel } from './components/BottomPanel';
import { ProjectWindow } from './components/ProjectWindow';
import { FileTabs } from './components/FileTabs';
import { SymbolWindow } from './components/SymbolWindow';
import { BookmarksSection } from './components/BookmarksSection';
import { EditorPane, getContent, getCursorLocation, getSelectedText, setDiskContent, disposeAllModels, isDiffTabPath, isDirCompareTabPath, isReviewTabPath } from './components/EditorPane';
import { normalizeSearchSeed } from './search-seed';
import { exportFileHtml } from './html-export';
import { CHAT_ERROR_TEXT } from './components/ChatPanel';
import { scheduleChatSave } from './chat-persist';
import { SearchOverlay } from './components/SearchOverlay';
import { RenameOverlay } from './components/RenameOverlay';
import { SettingsOverlay } from './components/SettingsOverlay';
import { goBack, goForward, navHistory } from './navigation';
import { monaco } from './monaco-setup';
import { applyThemeById } from './theming/apply';
import { lspSync } from './lsp-sync';
import { computeAnchor } from './bookmarks';
import { getTerminalView } from './terminal-view';
import type { Bookmark } from './bookmarks';
import type { UiState, IndexProgressPayload, FileIndexedPayload } from '../../shared/protocol';
import type { IndexStats } from '../../indexer/pipeline';

const EditorArea = () => (
  <div className="editor-area">
    <FileTabs />
    <EditorPane />
  </div>
);

async function openProject(root: string): Promise<void> {
  const st = useAppStore.getState();
  try {
    const res = await window.si.openProject(root);
    void window.si.chatCancel(); // 프로젝트 전환 시 진행 중 채팅 스트림 중단 (store 리셋은 setProject 담당)
    initLayouts(res.uiState?.panelLayouts);
    // 프로젝트 전환 시 이전 프로젝트의 모델 전부 폐기 — URI가 root 무관이라 재사용 오염 방지
    disposeAllModels();
    navHistory.reset(); // 이전 프로젝트의 뒤로/앞으로 히스토리 폐기

    st.setProject(res.root);
    applyUiState(res.uiState);
    void window.si.chatThreadsList().then(async (list) => {
      st.setThreads(list);
      if (list.length > 0) {
        const msgs = await window.si.chatThreadLoad(list[0].id);
        st.setActiveThreadId(list[0].id);
        st.loadThreadMessages(msgs as typeof st.chatMessages);
      }
    });
    void window.si.loadBookmarks().then((l) => st.setBookmarks(l as Bookmark[]));
  } catch (e) {
    st.setError(e instanceof Error ? e.message : String(e));
  }
}

// 가상 탭(diff/dircmp/review)은 openTab(path)로 복원할 수 없다 — 탭에 붙은 상태가 없어 빈 화면이 된다.
// 저장 단계에서 이미 제외하지만, 이전 버전이 저장해 둔 상태를 위해 복원 쪽에서도 걸러낸다.
const isVirtualTabPath = (p: string): boolean =>
  isDiffTabPath(p) || isDirCompareTabPath(p) || isReviewTabPath(p);

function applyUiState(ui: UiState | null): void {
  if (!ui) return;
  const st = useAppStore.getState();
  const paths = ui.openTabs.filter((p) => !isVirtualTabPath(p));
  for (const p of paths) st.openTab(p);
  if (ui.activeTab && paths.includes(ui.activeTab)) st.setActive(ui.activeTab);
}

async function toggleBookmark(): Promise<void> {
  const st = useAppStore.getState();
  const loc = getCursorLocation();
  if (!loc) return;
  // 같은 path + 같은 저장 line이면 제거, 아니면 추가
  const dup = st.bookmarks.find((b) => b.path === loc.path && b.line === loc.line);
  let next: Bookmark[];
  if (dup) {
    next = st.bookmarks.filter((b) => b !== dup);
  } else {
    const symbols = await window.si.getFileOutline(loc.path).catch(() => []);
    const anchor = computeAnchor(symbols, loc.line);
    const text = (getContent(loc.path)?.split('\n')[loc.line - 1] ?? '').trim().slice(0, 60);
    next = [...st.bookmarks, { path: loc.path, line: loc.line, ...anchor, text }];
  }
  st.setBookmarks(next);
  void window.si.saveBookmarks(next);
}

function handleIndexerEvent(event: string, payload: unknown): void {
  const st = useAppStore.getState();
  if (event === 'indexProgress') st.setIndexing(payload as IndexProgressPayload);
  if (event === 'indexDone') {
    st.setIndexing(null);
    st.setStats(payload as IndexStats);
    st.bumpOutline();
  }
  if (event === 'indexError') st.setError((payload as { message: string }).message);
  if (event === 'fileIndexed' || event === 'fileRemoved') {
    const payload2 = payload as FileIndexedPayload;
    const p = payload2.path;
    // 버퍼 인덱싱 유래 — dirty/디스크 리로드 블록 전체 스킵 (자기 타이핑이 ⚠를 만들면 안 됨)
    if (payload2.source === 'buffer') {
      if (p === st.activePath) st.bumpOutline();
      return;
    }
    if (p === st.activePath) st.bumpOutline();
    const tab = st.tabs.find((t) => t.path === p);
    if (tab) {
      if (event === 'fileRemoved' || tab.dirty) {
        if (getContent(p) !== null) st.markDiskChanged(p);
      } else {
        // dirty 아님 → 디스크 내용으로 조용히 리로드 (자기 저장으로 인한 이벤트면 내용 동일 → no-op)
        void window.si
          .readFile(p)
          .then((content) => {
            // readFile 사이에 사용자가 입력해 dirty가 됐으면 덮어쓰지 않고 ⚠ 표시로 전환
            const now = useAppStore.getState().tabs.find((t) => t.path === p);
            if (now?.dirty) st.markDiskChanged(p);
            else setDiskContent(p, content);
          })
          .catch(() => {});
      }
    }
  }
}

// react-resizable-panels v4 어댑테이션:
//   브리프의 v2/v3 API(PanelGroup/PanelResizeHandle, direction, autoSaveId+storage)는 v4에서
//   Group/Separator, orientation, useDefaultLayout({ id, storage })로 바뀌었다.
//   useDefaultLayout은 layoutStorage(getItem/setItem)를 그대로 소비하므로 persistence-bridge는 무변경.
//   Group/Panel에 안정적인 id를 부여해 레이아웃이 패널별로 저장·복원되게 한다.
//   숫자 size는 v4에서 픽셀이므로 백분율은 문자열("78" = 78%)로 지정한다.
//   이 Workspace를 App에서 key={root}로 마운트해 프로젝트 전환 시 저장된 레이아웃을 재적용한다.
function Workspace() {
  const rootV = useDefaultLayout({ id: 'root-v', storage: layoutStorage });
  const mainH = useDefaultLayout({ id: 'main-h', storage: layoutStorage });
  const sideV = useDefaultLayout({ id: 'side-v', storage: layoutStorage });
  // 레이아웃 프리셋 — 그룹 임퍼러티브 핸들 등록 (캡처/적용용)
  const rootVRef = useGroupRef();
  const mainHRef = useGroupRef();
  const sideVRef = useGroupRef();
  useEffect(() => {
    registerLayoutGroup('root-v', () => rootVRef.current);
    registerLayoutGroup('main-h', () => mainHRef.current);
    registerLayoutGroup('side-v', () => sideVRef.current);
  }, [rootVRef, mainHRef, sideVRef]);
  // 접힘은 min=max=헤더높이로 패널 크기를 '잠가서' 구현한다. collapse()의 여유공간
  // 재분배(인접 형제로 흘러 다른 패널이 다시 열리는 문제)를 피하고, 남는 공간은
  // 잠기지 않은 project로만 흐르므로 두 패널이 완전히 독립적으로 접힌다.
  const [symbolsCollapsed, setSymbolsCollapsed] = useState(false);
  const [bookmarksCollapsed, setBookmarksCollapsed] = useState(false);
  return (
    <Group
      orientation="vertical"
      id="root-v"
      groupRef={rootVRef}
      defaultLayout={rootV.defaultLayout}
      onLayoutChanged={rootV.onLayoutChanged}
    >
      <Panel id="top" defaultSize="78" minSize="40">
        <Group
          orientation="horizontal"
          id="main-h"
          groupRef={mainHRef}
          defaultLayout={mainH.defaultLayout}
          onLayoutChanged={mainH.onLayoutChanged}
        >
          <Panel id="side" defaultSize="20" minSize="12" collapsible>
            <Group
              orientation="vertical"
              id="side-v"
              groupRef={sideVRef}
              defaultLayout={sideV.defaultLayout}
              onLayoutChanged={sideV.onLayoutChanged}
            >
              <Panel id="project" defaultSize="45" minSize="15"><ProjectWindow /></Panel>
              <Separator className="resize-handle resize-handle-v" />
              <Panel
                id="symbols"
                defaultSize="30"
                minSize={symbolsCollapsed ? '24px' : '15'}
                maxSize={symbolsCollapsed ? '24px' : undefined}
              >
                <SymbolWindow
                  collapsed={symbolsCollapsed}
                  onToggle={() => setSymbolsCollapsed((v) => !v)}
                />
              </Panel>
              <Separator className="resize-handle resize-handle-v" />
              <Panel
                id="bookmarks"
                defaultSize="25"
                minSize={bookmarksCollapsed ? '24px' : '10'}
                maxSize={bookmarksCollapsed ? '24px' : undefined}
              >
                <BookmarksSection
                  collapsed={bookmarksCollapsed}
                  onToggle={() => setBookmarksCollapsed((v) => !v)}
                />
              </Panel>
            </Group>
          </Panel>
          <Separator className="resize-handle resize-handle-h" />
          <Panel id="editor" minSize="30"><EditorArea /></Panel>
          <Separator className="resize-handle resize-handle-h" />
          <Panel id="relation" defaultSize="18" minSize="10" collapsible><RightPanel /></Panel>
        </Group>
      </Panel>
      <Separator className="resize-handle resize-handle-v" />
      <Panel id="context" defaultSize="22" minSize="8" collapsible><BottomPanel /></Panel>
    </Group>
  );
}

/** 커스텀 캡션바 — 네이티브 타이틀바 대신 테마 색을 따르는 드래그 영역 (main: titleBarStyle hiddenInset) */
function CaptionBar() {
  const root = useAppStore((s) => s.root);
  const name = root?.split('/').pop();
  return <div className="caption-bar">{name ? `${name} — Puppet Master` : 'Puppet Master'}</div>;
}

export function App() {
  const root = useAppStore((s) => s.root);

  // 시작 시 저장된 외관 테마 적용 (EditorPane 마운트 전이어도 defineTheme/setTheme는 전역 유효)
  useEffect(() => {
    void window.si.getAppearance().then((a) => applyThemeById(monaco, a.theme));
  }, []);

  useEffect(() => {
    window.si.onIndexerEvent(handleIndexerEvent);
    window.si.onMenu((action) => {
      if (action.type === 'open-folder') {
        void window.si.openFolderDialog().then((r) => {
          if (r) void openProject(r);
        });
      }
      if (action.type === 'open-recent') void openProject(action.root);
      if (action.type === 'save') window.dispatchEvent(new CustomEvent('si:save'));
      if (action.type === 'export-html') {
        const p = useAppStore.getState().activePath;
        if (p && !isDiffTabPath(p)) void exportFileHtml(monaco, p);
      }
      if (action.type === 'find-in-files') {
        useAppStore.getState().setSearchSeed(normalizeSearchSeed(getSelectedText()));
        useAppStore.getState().setSearchOpen(true);
      }
      if (action.type === 'review') useAppStore.getState().openReviewTab();
    });
    // 채팅 스트림 이벤트 구독 — App은 항상 마운트 상태이므로 RightPanel의 탭 전환으로
    // ChatPanel이 언마운트돼도 이벤트가 유실되지 않는다 (P1 수정).
    const offChat = window.si.onChatEvent((e) => {
      const st = useAppStore.getState();
      if (e.type === 'chunk') st.appendChatChunk(e.text);
      else if (e.type === 'done') { st.setChatStreaming(false); scheduleChatSave(); }
      else {
        st.setChatError(CHAT_ERROR_TEXT[e.kind] ?? CHAT_ERROR_TEXT.other);
        st.setChatStreaming(false);
      }
    });
    // 에이전트 이벤트 — 채팅과 동일하게 App에서 구독 (탭 전환 언마운트 유실 방지, Plan 8 P1)
    window.si.onAgentEvent((ev) => {
      const st = useAppStore.getState();
      if (ev.type === 'chunk') st.appendChatChunk(ev.text);
      else if (ev.type === 'tool') {
        st.upsertChatTool({ id: ev.id, name: ev.name, summary: ev.summary, state: ev.state, detail: ev.detail, path: ev.path, before: ev.before, after: ev.after });
        if (ev.name === 'write_file' && ev.state === 'done') {
          st.bumpTreeRefresh();
          // 승인 대기 중 열어둔 변경 제안 탭은 실행 완료 시 자동으로 닫는다 (내용이 stale)
          if (st.tabs.some((t) => t.path === `diff://${ev.path}`)) st.closeTab(`diff://${ev.path}`);
        }
      } else if (ev.type === 'worktree') {
        // 격리 턴 종료 — 변경이 있으면 적용 바 표시, 없으면 클리어
        st.setWorktreeChanges(ev.changes.length > 0 ? ev.changes : null);
      } else if (ev.type === 'done') { st.setChatStreaming(false); scheduleChatSave(); }
      else {
        st.setChatError(CHAT_ERROR_TEXT[ev.kind] ?? CHAT_ERROR_TEXT.other);
        st.setChatStreaming(false);
      }
    });
    const unsub = useAppStore.subscribe(scheduleSave);
    return () => {
      offChat();
      unsub();
    };
  }, []);

  useEffect(() => {
    let saving = false;
    const save = async () => {
      if (saving) return;
      const st = useAppStore.getState();
      if (!st.activePath) return;
      const tab = st.tabs.find((t) => t.path === st.activePath);
      if (!tab?.dirty) return;
      const content = getContent(st.activePath);
      if (content == null) return;
      saving = true;
      try {
        await window.si.saveFile(st.activePath, content);
        st.setDirty(st.activePath, false);
        st.setError(null);
        lspSync.lspSave(st.activePath);
      } catch (e) {
        st.setError(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        saving = false;
      }
    };
    const onSave = () => void save();
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === 'f' || ev.key === 'F')) {
        ev.preventDefault();
        const willOpen = !useAppStore.getState().searchOpen;
        // 열리는 경우에만 선택 텍스트를 시드로 (닫을 때는 건드리지 않음)
        if (willOpen) useAppStore.getState().setSearchSeed(normalizeSearchSeed(getSelectedText()));
        useAppStore.getState().setSearchOpen(willOpen);
        return;
      }
      if (ev.ctrlKey && ev.key === '`') {
        ev.preventDefault();
        const st = useAppStore.getState();
        st.setBottomTab('terminal');
        requestAnimationFrame(() => {
          const id = useAppStore.getState().activeTerminalId;
          if (id != null) getTerminalView(id)?.focus();
        });
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === ',') {
        ev.preventDefault();
        useAppStore.getState().setSettingsOpen(!useAppStore.getState().settingsOpen);
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'F2') {
        ev.preventDefault();
        void toggleBookmark();
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
        ev.preventDefault();
        ev.stopPropagation(); // 캡처 단계에서 소비 — Monaco 자체 바인딩과의 이중 발화 방지
        void save();
        return;
      }
      if (ev.altKey && ev.key === 'ArrowLeft') {
        ev.preventDefault();
        goBack();
        return;
      }
      if (ev.altKey && ev.key === 'ArrowRight') {
        ev.preventDefault();
        goForward();
        return;
      }
      // Backspace 뒤로 — 에디터/입력 요소 밖에서만 (스펙 결정 기록)
      const el = document.activeElement;
      if (
        ev.key === 'Backspace' &&
        !el?.closest('.editor-host') &&
        !el?.closest('.search-backdrop') &&
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLTextAreaElement)
      ) {
        ev.preventDefault();
        goBack();
      }
    };
    // 마우스 뒤로/앞으로 버튼 (button 3/4)
    const onMouse = (ev: MouseEvent) => {
      if (ev.button === 3) {
        ev.preventDefault();
        goBack();
      }
      if (ev.button === 4) {
        ev.preventDefault();
        goForward();
      }
    };
    window.addEventListener('si:save', onSave);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('si:save', onSave);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);

  if (!root)
    return (
      <div className="app">
        <CaptionBar />
        <div className="app-main">
          <EmptyState onOpen={(r) => void openProject(r)} />
        </div>
      </div>
    );

  return (
    <div className="app">
      <CaptionBar />
      <div className="app-main">
        <Workspace key={root} />
      </div>
      <StatusBar />
      <SearchOverlay />
      <RenameOverlay />
      <SettingsOverlay />
    </div>
  );
}
