import { useEffect, useMemo, useRef, useState } from 'react';
// @ts-expect-error monaco 내부 모듈 — 타입 선언 없음 (경로 변동 시 빌드에서 즉시 실패)
import { OverviewRulerFeature } from 'monaco-editor/esm/vs/editor/browser/widget/diffEditor/features/overviewRulerFeature.js';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { composeDiffFeedback, type DiffAnnotation } from '../diff-feedback';

// Monaco diff 오버뷰 룰러 폭은 내부 상수(ONE_OVERVIEW_WIDTH=15 → 30px)일 뿐 강제 값이 아니다.
// diff 에디터 생성 전(모듈 로드 시) static을 낮춰 예약 레인·스크롤바 위치·룰러 폭을 일관되게
// 축소한다 — CSS scaleX 없이 스크롤바에 밀착, 갭/여백 없음. static import라 경로 변동 시 빌드에서 즉시 실패.
const OW = OverviewRulerFeature as unknown as { ONE_OVERVIEW_WIDTH: number; ENTIRE_DIFF_OVERVIEW_WIDTH: number };
OW.ONE_OVERVIEW_WIDTH = 8;
OW.ENTIRE_DIFF_OVERVIEW_WIDTH = 16; // 8(삭제) + 8(추가)

/** 에이전트 변경 제안 diff — Monaco DiffEditor (읽기 전용, 임시 인메모리 모델).
 * Monaco DiffEditor는 진짜 미니맵을 강제 비활성하므로 diff 오버뷰 룰러가 그 역할을 한다.
 * origin==='agent'|'review'이면 하단에 줄 주석 바를 표시해 코멘트를 모아 채팅 피드백으로 보낼 수 있다.
 * revealLine(1-based)이 있으면 마운트 시 해당 줄로 스크롤(리뷰 심볼 점프). */
export function DiffView({ path, before, after, origin, revealLine }: { path: string; before: string; after: string; origin?: 'agent' | 'compare' | 'review'; revealLine?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [curLine, setCurLine] = useState(1); // modified(오른쪽) 에디터 현재 줄 (1-기반)
  const [comment, setComment] = useState('');
  const [annotations, setAnnotations] = useState<DiffAnnotation[]>([]);
  const afterLines = useMemo(() => after.split('\n'), [after]);

  // diff 탭이 바뀌면(같은 컴포넌트 인스턴스 재사용) 주석/입력을 초기화 — 세션 한정, 파일별 격리
  useEffect(() => {
    setAnnotations([]);
    setComment('');
    setCurLine(1);
  }, [path]);

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
    // 리뷰 심볼 점프 — 양쪽 에디터를 해당 줄로 스크롤 (삭제 심볼은 옛 줄, 추가/수정은 새 줄 기준이라 둘 다 reveal)
    if (revealLine && revealLine > 0) {
      ed.getModifiedEditor().revealLineInCenter(revealLine);
      ed.getOriginalEditor().revealLineInCenter(revealLine);
    }
    // modified(오른쪽) 에디터 커서 줄 추적 — 주석은 after 기준 줄에 단다
    const sub = ed.getModifiedEditor().onDidChangeCursorPosition((e) => setCurLine(e.position.lineNumber));
    return () => {
      sub.dispose();
      ed.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [path, before, after, revealLine]);

  const addAnnotation = () => {
    const c = comment.trim();
    if (!c) return;
    const lineText = afterLines[curLine - 1] ?? '';
    setAnnotations((prev) => [...prev.filter((a) => a.line !== curLine), { line: curLine, lineText, comment: c }]); // 같은 줄 재입력 → 교체
    setComment('');
  };
  const removeAnnotation = (line: number) => setAnnotations((prev) => prev.filter((a) => a.line !== line));
  const sendFeedback = () => {
    if (annotations.length === 0) return;
    const st = useAppStore.getState();
    st.setChatDraft(composeDiffFeedback(path, annotations));
    st.setRightTab('chat');
  };

  const sorted = [...annotations].sort((a, b) => a.line - b.line);

  return (
    <div className="diff-tab-wrap">
      <div ref={hostRef} className="diff-tab-host" />
      {(origin === 'agent' || origin === 'review') && (
        <div className="diff-annotate-bar">
          <div className="diff-annotate-input-row">
            <span className="diff-annotate-line">현재 {curLine}행</span>
            <input
              className="diff-annotate-input"
              placeholder="이 줄에 대한 코멘트…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addAnnotation(); }}
            />
            <button className="rename-btn" onClick={addAnnotation} disabled={!comment.trim()}>추가</button>
          </div>
          {sorted.length > 0 && (
            <div className="diff-annotate-list">
              {sorted.map((a) => (
                <div key={a.line} className="diff-annotate-item">
                  <span className="diff-annotate-item-line">{a.line}행</span>
                  <span className="diff-annotate-item-comment" title={a.comment}>{a.comment}</span>
                  <button className="diff-annotate-del" title="삭제" onClick={() => removeAnnotation(a.line)}>×</button>
                </div>
              ))}
              <button className="rename-btn primary diff-annotate-send" onClick={sendFeedback}>
                채팅으로 피드백 보내기 ({sorted.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
