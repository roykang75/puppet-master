import { useEffect } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useAppStore } from './store';
import { initLayouts, layoutStorage, scheduleSave } from './persistence-bridge';
import { EmptyState } from './components/EmptyState';
import { StatusBar } from './components/StatusBar';
import { RelationPanel } from './components/RelationPanel';
import { ContextPanel } from './components/ContextPanel';
import { ProjectWindow } from './components/ProjectWindow';
import { FileTabs } from './components/FileTabs';
import { SymbolWindow } from './components/SymbolWindow';
import { BookmarksSection } from './components/BookmarksSection';
import { EditorPane, getContent, getCursorLocation, setDiskContent, disposeAllModels } from './components/EditorPane';
import { SearchOverlay } from './components/SearchOverlay';
import { goBack, goForward } from './navigation';
import { computeAnchor } from './bookmarks';
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
    initLayouts(res.uiState?.panelLayouts);
    // 프로젝트 전환 시 이전 프로젝트의 모델 전부 폐기 — URI가 root 무관이라 재사용 오염 방지
    disposeAllModels();
    st.setProject(res.root);
    applyUiState(res.uiState);
    void window.si.loadBookmarks().then((l) => st.setBookmarks(l as Bookmark[]));
  } catch (e) {
    st.setError(e instanceof Error ? e.message : String(e));
  }
}

function applyUiState(ui: UiState | null): void {
  if (!ui) return;
  const st = useAppStore.getState();
  for (const p of ui.openTabs) st.openTab(p);
  if (ui.activeTab) st.setActive(ui.activeTab);
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
  return (
    <Group
      orientation="vertical"
      id="root-v"
      defaultLayout={rootV.defaultLayout}
      onLayoutChanged={rootV.onLayoutChanged}
    >
      <Panel id="top" defaultSize="78" minSize="40">
        <Group
          orientation="horizontal"
          id="main-h"
          defaultLayout={mainH.defaultLayout}
          onLayoutChanged={mainH.onLayoutChanged}
        >
          <Panel id="side" defaultSize="20" minSize="12" collapsible>
            <Group
              orientation="vertical"
              id="side-v"
              defaultLayout={sideV.defaultLayout}
              onLayoutChanged={sideV.onLayoutChanged}
            >
              <Panel id="project" defaultSize="45" minSize="15"><ProjectWindow /></Panel>
              <Separator className="resize-handle resize-handle-v" />
              <Panel id="symbols" defaultSize="30" minSize="15"><SymbolWindow /></Panel>
              <Separator className="resize-handle resize-handle-v" />
              <Panel id="bookmarks" defaultSize="25" minSize="10"><BookmarksSection /></Panel>
            </Group>
          </Panel>
          <Separator className="resize-handle resize-handle-h" />
          <Panel id="editor" minSize="30"><EditorArea /></Panel>
          <Separator className="resize-handle resize-handle-h" />
          <Panel id="relation" defaultSize="18" minSize="10" collapsible><RelationPanel /></Panel>
        </Group>
      </Panel>
      <Separator className="resize-handle resize-handle-v" />
      <Panel id="context" defaultSize="22" minSize="8" collapsible><ContextPanel /></Panel>
    </Group>
  );
}

export function App() {
  const root = useAppStore((s) => s.root);

  useEffect(() => {
    window.si.onIndexerEvent(handleIndexerEvent);
    window.si.onMenu((action) => {
      if (action.type === 'open-folder') {
        void window.si.openFolderDialog().then((r) => r && openProject(r));
      }
      if (action.type === 'open-recent') void openProject(action.root);
      if (action.type === 'save') window.dispatchEvent(new CustomEvent('si:save'));
    });
    const unsub = useAppStore.subscribe(scheduleSave);
    return unsub;
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
        useAppStore.getState().setSearchOpen(!useAppStore.getState().searchOpen);
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

  if (!root) return <EmptyState onOpen={(r) => void openProject(r)} />;

  return (
    <div className="app">
      <div className="app-main">
        <Workspace key={root} />
      </div>
      <StatusBar />
      <SearchOverlay />
    </div>
  );
}
