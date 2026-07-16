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
import { EditorPane, getContent, disposeAllModels } from './components/EditorPane';
import type { UiState, IndexProgressPayload, FileIndexedPayload } from '../../shared/protocol';
import type { IndexStats } from '../../indexer/pipeline';

// Task 9에서 실제 컴포넌트로 교체된다
const SymbolWindow = () => (
  <div className="panel"><div className="panel-title">Symbols</div><div className="panel-body" /></div>
);
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
    const p = (payload as FileIndexedPayload).path;
    if (p === st.activePath) st.bumpOutline();
    // 열린 파일의 외부 변경 처리는 Task 9에서 확장
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
              <Panel id="project" defaultSize="55" minSize="20"><ProjectWindow /></Panel>
              <Separator className="resize-handle resize-handle-v" />
              <Panel id="symbols" minSize="20"><SymbolWindow /></Panel>
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
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
        ev.preventDefault();
        ev.stopPropagation(); // 캡처 단계에서 소비 — Monaco 자체 바인딩과의 이중 발화 방지
        void save();
      }
    };
    window.addEventListener('si:save', onSave);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('si:save', onSave);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  if (!root) return <EmptyState onOpen={(r) => void openProject(r)} />;

  return (
    <div className="app">
      <div className="app-main">
        <Workspace key={root} />
      </div>
      <StatusBar />
    </div>
  );
}
