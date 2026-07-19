import { useEffect, useRef } from 'react';
// @ts-expect-error monaco 내부 모듈 — 타입 선언 없음 (경로 변동 시 빌드에서 즉시 실패)
import { OverviewRulerFeature } from 'monaco-editor/esm/vs/editor/browser/widget/diffEditor/features/overviewRulerFeature.js';
import { monaco } from '../monaco-setup';

// Monaco diff 오버뷰 룰러 폭은 내부 상수(ONE_OVERVIEW_WIDTH=15 → 30px)일 뿐 강제 값이 아니다.
// diff 에디터 생성 전(모듈 로드 시) static을 낮춰 예약 레인·스크롤바 위치·룰러 폭을 일관되게
// 축소한다 — CSS scaleX 없이 스크롤바에 밀착, 갭/여백 없음. static import라 경로 변동 시 빌드에서 즉시 실패.
const OW = OverviewRulerFeature as unknown as { ONE_OVERVIEW_WIDTH: number; ENTIRE_DIFF_OVERVIEW_WIDTH: number };
OW.ONE_OVERVIEW_WIDTH = 8;
OW.ENTIRE_DIFF_OVERVIEW_WIDTH = 16; // 8(삭제) + 8(추가)

/** 에이전트 변경 제안 diff — Monaco DiffEditor (읽기 전용, 임시 인메모리 모델).
 * Monaco DiffEditor는 진짜 미니맵을 강제 비활성하므로 diff 오버뷰 룰러가 그 역할을 한다. */
export function DiffView({ path, before, after }: { path: string; before: string; after: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    // Uri.from: 경로에 공백·비ASCII(파일 비교의 "A ↔ B")가 와도 안전. 언어는 마지막 세그먼트 확장자로 추정.
    const original = monaco.editor.createModel(before, undefined, monaco.Uri.from({ scheme: 'agent-diff', authority: 'before', path: '/' + path }));
    const modified = monaco.editor.createModel(after, undefined, monaco.Uri.from({ scheme: 'agent-diff', authority: 'after', path: '/' + path }));
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
