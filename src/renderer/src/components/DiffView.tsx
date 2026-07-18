import { useEffect, useRef } from 'react';
import { monaco } from '../monaco-setup';

/** 에이전트 변경 제안 diff — Monaco DiffEditor (읽기 전용, 임시 인메모리 모델).
 * Monaco DiffEditor는 진짜 미니맵을 강제 비활성하므로 diff 오버뷰 룰러가 그 역할을 한다. */
export function DiffView({ path, before, after }: { path: string; before: string; after: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const original = monaco.editor.createModel(before, undefined, monaco.Uri.parse(`agent-diff://before/${path}`));
    const modified = monaco.editor.createModel(after, undefined, monaco.Uri.parse(`agent-diff://after/${path}`));
    const ed = monaco.editor.createDiffEditor(hostRef.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      renderSideBySideInlineBreakpoint: 600, // 좁으면 인라인 diff로 자동 전환
      renderOverviewRuler: true, // diff 위치 미니맵 역할
      overviewRulerLanes: 0, // 커서/선택 데코레이션 캔버스는 제거 (룰러를 가리던 세로 막대)
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    });
    ed.setModel({ original, modified });
    return () => {
      ed.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [path, before, after]);

  return <div ref={hostRef} className="diff-tab-host" />;
}
