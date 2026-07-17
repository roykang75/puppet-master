// VS Code 테마 JSON → Monaco defineTheme + 앱 CSS 변수. 순수 함수 — DOM/monaco 임포트 금지.
export interface ConvertedTheme {
  name: string;
  kind: 'dark' | 'light';
  monacoTheme: {
    base: 'vs' | 'vs-dark';
    inherit: true;
    rules: { token: string; foreground?: string; fontStyle?: string }[];
    colors: Record<string, string>;
  };
  uiVars: Record<string, string>;
}

// theme.css 변수 ← VS Code colors 키 (앞선 키 우선)
const UI_VAR_SOURCES: Record<string, string[]> = {
  '--bg': ['editor.background'],
  '--bg-panel': ['sideBar.background', 'editor.background'],
  '--bg-hover': ['list.hoverBackground'],
  '--bg-active': ['list.activeSelectionBackground'],
  '--border': ['panel.border', 'editorGroup.border', 'contrastBorder'],
  '--fg': ['foreground', 'editor.foreground'],
  '--fg-dim': ['descriptionForeground'],
  '--accent': ['focusBorder', 'button.background'],
  '--warn': ['editorWarning.foreground'],
};

interface RawTokenColor { scope?: string | string[]; settings?: { foreground?: string; fontStyle?: string } }

export function convertTheme(raw: unknown): ConvertedTheme | null {
  if (raw == null || typeof raw !== 'object') return null;
  const t = raw as { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: unknown };
  if (t.tokenColors != null && !Array.isArray(t.tokenColors)) return null;
  const colors = t.colors && typeof t.colors === 'object' ? t.colors : {};
  const kind: 'dark' | 'light' = t.type === 'light' ? 'light' : 'dark';

  const rules: ConvertedTheme['monacoTheme']['rules'] = [];
  for (const tc of (t.tokenColors ?? []) as RawTokenColor[]) {
    if (!tc?.scope || !tc.settings) continue; // 전역 기본(scope 없음)은 base가 담당
    const { foreground, fontStyle } = tc.settings;
    if (!foreground && !fontStyle) continue;
    const scopes = (Array.isArray(tc.scope) ? tc.scope : tc.scope.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    for (const scope of scopes) {
      const rule: (typeof rules)[number] = { token: scope };
      if (foreground) rule.foreground = foreground.replace(/^#/, '');
      if (fontStyle) rule.fontStyle = fontStyle;
      rules.push(rule);
    }
  }

  const uiVars: Record<string, string> = {};
  for (const [cssVar, sources] of Object.entries(UI_VAR_SOURCES)) {
    for (const key of sources) {
      const v = colors[key];
      if (typeof v === 'string' && v) {
        uiVars[cssVar] = v;
        break;
      }
    }
  }

  // 스크롤바 슬라이더 폴백 — 테마가 정의하지 않으면 전역 CSS(theme.css)와 같은 톤다운 블랙으로 통일
  const monacoColors: Record<string, string> = {
    'scrollbarSlider.background': '#3f3f3f',
    'scrollbarSlider.hoverBackground': '#4f4f4f',
    'scrollbarSlider.activeBackground': '#5f5f5f',
    ...colors,
  };

  return {
    name: typeof t.name === 'string' && t.name ? t.name : 'theme',
    kind,
    monacoTheme: { base: kind === 'light' ? 'vs' : 'vs-dark', inherit: true, rules, colors: monacoColors },
    uiVars,
  };
}
