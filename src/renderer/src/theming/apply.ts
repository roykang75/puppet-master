// 테마 적용 — defineTheme/setTheme + CSS 변수 주입 + kind dataset (sem 프리셋 전환)
import type * as Monaco from 'monaco-editor';
import { convertTheme } from './convert';
import { BUNDLED_THEME_DATA } from './bundled';

const UI_VARS = ['--bg', '--bg-panel', '--bg-hover', '--bg-active', '--border', '--fg', '--fg-dim', '--accent', '--warn'];

async function resolveThemeData(id: string): Promise<unknown | null> {
  if (id.startsWith('user:')) return window.si.themeRead(id).catch(() => null);
  return BUNDLED_THEME_DATA[id] ?? null;
}

export async function applyThemeById(monaco: typeof Monaco, id: string): Promise<void> {
  let converted = convertTheme(await resolveThemeData(id));
  if (!converted) converted = convertTheme(BUNDLED_THEME_DATA['dark-plus'])!; // 폴백 (스펙 §2)
  monaco.editor.defineTheme('si-theme', converted.monacoTheme as Monaco.editor.IStandaloneThemeData);
  monaco.editor.setTheme('si-theme');
  const rootStyle = document.documentElement.style;
  for (const v of UI_VARS) rootStyle.removeProperty(v); // 이전 테마 잔여 제거 → CSS 기본값 복귀
  for (const [k, val] of Object.entries(converted.uiVars)) rootStyle.setProperty(k, val);
  document.documentElement.dataset.themeKind = converted.kind; // sem 프리셋 전환
  window.dispatchEvent(new CustomEvent('si:theme-changed'));
}
