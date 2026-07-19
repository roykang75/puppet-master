// HTML 문서 조립 (순수 — DOM/monaco 임포트 금지, 테스트 가능).
const FONT = '"SF Mono", Menlo, Consolas, "Courier New", monospace';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface HtmlDocParts {
  title: string;
  bodyHtml: string; // Monaco colorize 결과 (mtkN 스팬 + <br/>)
  tokenCss: string; // 수집한 .mtkN 색 규칙
  bg: string;
  fg: string;
}

/** 자기완결 HTML 문서 문자열 구성. */
export function buildHtmlDocument({ title, bodyHtml, tokenCss, bg, fg }: HtmlDocParts): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body { margin: 0; background: ${bg || '#1e1e1e'}; color: ${fg || '#d4d4d4'}; }
.code { white-space: pre; font-family: ${FONT}; font-size: 13px; line-height: 1.5; padding: 16px; tab-size: 4; }
${tokenCss}
</style></head>
<body><div class="code">${bodyHtml}</div></body></html>`;
}
