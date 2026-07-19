// HTML 내보내기 — 활성 파일을 하이라이트된 자기완결 HTML로.
// Monaco colorize(.mtkN 스팬) + 라이브 스타일시트의 .mtk 색 규칙 + 테마 --bg/--fg를 인라인.
import type * as Monaco from 'monaco-editor';
import { editorUriOf } from './components/EditorPane';
import { buildHtmlDocument } from './html-doc';

/** 라이브 문서 스타일시트에서 Monaco 토큰 색 규칙(.mtkN/.mtki/.mtkb)을 수집. */
export function collectTokenCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules; // cross-origin 시트는 접근 시 throw — 무시
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      const sel = (rule as CSSStyleRule).selectorText;
      if (sel && /\.mtk[0-9ib]/.test(sel)) {
        // '.monaco-editor .mtkN {…}' → '.mtkN {…}' (내보낸 문서의 .code 컨테이너에 직접 적용)
        out.push(rule.cssText.replace(/\.monaco-editor\s+/g, ''));
      }
    }
  }
  return out.join('\n');
}

/** 활성 파일을 HTML로 내보내기 (저장 다이얼로그). 성공 시 저장 경로, 취소/실패/모델없음 시 null. */
export async function exportFileHtml(monaco: typeof Monaco, relPath: string): Promise<string | null> {
  const model = monaco.editor.getModel(editorUriOf(relPath));
  if (!model) return null;
  const bodyHtml = await monaco.editor.colorize(model.getValue(), model.getLanguageId(), {});
  const cs = getComputedStyle(document.documentElement);
  const name = relPath.split('/').pop() || 'export';
  const doc = buildHtmlDocument({
    title: name,
    bodyHtml,
    tokenCss: collectTokenCss(),
    bg: cs.getPropertyValue('--bg').trim(),
    fg: cs.getPropertyValue('--fg').trim(),
  });
  return window.si.exportHtml(`${name}.html`, doc);
}
