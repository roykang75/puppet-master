import type * as Monaco from 'monaco-editor';
import { useAppStore } from './store';
import type { CompletionContext, CompletionSettings } from '../../shared/protocol';

// ── 설정 캐시 (모듈 변수) ──
// registerCompletionProvider 시 1회 로드, SettingsOverlay 저장 후 refreshCompletionSettings로 갱신.
let settings: CompletionSettings | null = null;

// ── 비활성 정책 상태 ──
// auth 오류: 설정 변경(refreshCompletionSettings)까지 비활성.
// transient/other 오류: Date.now() < disabledUntil 동안 비활성 (60초 백오프).
let authDisabled = false;
let disabledUntil = 0;

// ── 세대 토큰 ──
// 늦게 도착한 응답이 최신 요청을 덮어쓰지 못하도록: 요청 시 증가, 응답 시 최신 세대와 비교.
let generation = 0;

let registered = false;
let monacoRef: typeof Monaco | null = null; // Range 생성용 (registerCompletionProvider에서 설정)

async function loadSettings(): Promise<void> {
  settings = await window.si.getCompletionSettings().catch(() => null);
}

/** SettingsOverlay 저장 성공 후 호출 — 캐시 재조회 + auth 비활성 해제. */
export async function refreshCompletionSettings(): Promise<void> {
  authDisabled = false; // 설정 변경 → 인증 오류 비활성 해제
  disabledUntil = 0; // transient/other 백오프도 해제 — 설정 변경으로 재시도 허용
  generation++; // 세대 증가 — 설정 변경 전 in-flight 응답이 이후 표시되지 않도록 (stale ghost 차단)
  useAppStore.getState().setCompletionStatus(null); // 이전 오류 상태 표시 제거
  await loadSettings();
}

/** IPC를 보낼 가치가 있는 활성 상태인가 (설정/백오프 단락 — 여기서 false면 요청 0회). */
function isEnabled(): boolean {
  if (!settings || settings.provider === 'none') return false;
  if (settings.provider === 'anthropic' && !settings.hasApiKey) return false;
  if (authDisabled) return false;
  if (Date.now() < disabledUntil) return false;
  return true;
}

async function provideInlineCompletions(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  _context: Monaco.languages.InlineCompletionContext,
  token: Monaco.CancellationToken,
): Promise<Monaco.languages.InlineCompletions> {
  const empty: Monaco.languages.InlineCompletions = { items: [] };

  // si-preview 등 파일이 아닌 모델은 완성 대상 아님 (ContextPanel 미리보기 → IPC 0회 보장).
  if (model.uri.scheme !== 'file') return empty;
  if (!isEnabled()) return empty;

  // prefix ≤50줄 / suffix ≤10줄 추출.
  const prefixStartLine = Math.max(1, position.lineNumber - 50);
  const prefix = model.getValueInRange({
    startLineNumber: prefixStartLine,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const suffixEndLine = Math.min(model.getLineCount(), position.lineNumber + 10);
  const suffix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: suffixEndLine,
    endColumn: model.getLineMaxColumn(suffixEndLine),
  });

  const ctx: CompletionContext = {
    // EditorPane uri 규약: monaco.Uri.file('/' + relPath) → uri.path는 '/relPath'. 선두 '/' 제거.
    path: model.uri.path.replace(/^\//, ''),
    languageId: model.getLanguageId(),
    prefix,
    suffix,
  };

  const gen = ++generation;
  const res = await window.si.requestCompletion(ctx).catch(() => null);

  // 취소되었거나(응답 대기 중 새 요청/타이핑) 더 최신 요청이 생겼으면 이 응답을 버린다.
  if (token.isCancellationRequested || gen !== generation || !res) return empty;

  const store = useAppStore.getState();

  if (res.error) {
    if (res.error.kind === 'auth' || res.error.kind === 'unsuitable') {
      authDisabled = true; // 설정 변경까지 비활성
      store.setCompletionStatus(
        res.error.kind === 'auth'
          ? 'AI 완성: 인증 오류 — 설정 확인'
          : 'AI 완성: 모델이 완성에 부적합(추론 모델) — 설정 확인',
      );
    } else {
      disabledUntil = Date.now() + 60_000; // transient/other → 60초 백오프
      store.setCompletionStatus('AI 완성: 일시 중지');
    }
    return empty;
  }

  store.setCompletionStatus(null); // 성공 — 상태 복구
  if (res.text == null) return empty;
  // range를 명시하지 않으면 Monaco가 "현재 단어 전체 교체"로 간주해 insertText가 그 단어로
  // 시작하지 않는 항목을 걸러낸다 (커서가 식별자 끝일 때 고스트가 안 뜨는 원인).
  // postProcess가 prefix 중복을 제거하므로 커서 위치의 빈 range로 그대로 삽입한다.
  const cursorRange = new monacoRef!.Range(
    position.lineNumber,
    position.column,
    position.lineNumber,
    position.column,
  );
  return { items: [{ insertText: res.text, range: cursorRange }] };
}

/** 앱 수명 1회 등록 (EditorPane mount effect). 재마운트 이중 등록은 모듈 플래그로 방지. */
export function registerCompletionProvider(monaco: typeof import('monaco-editor')): void {
  if (registered) return;
  registered = true;
  monacoRef = monaco;
  void loadSettings();
  // '*' — Monaco LanguageSelector 와일드카드(모든 언어). 앱은 파일 유형이 다양하므로 광역 선택자가 최선.
  monaco.languages.registerInlineCompletionsProvider('*', {
    debounceDelayMs: 300,
    provideInlineCompletions,
    // Monaco 0.55 필수 멤버 (freeInlineCompletions 아님) — 정리 대상 없어 no-op.
    disposeInlineCompletions() {},
  });
}
