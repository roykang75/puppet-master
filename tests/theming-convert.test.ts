import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { convertTheme } from '../src/renderer/src/theming/convert';

const sample = {
  name: 'Sample', type: 'light',
  colors: {
    'editor.background': '#ffffff', 'sideBar.background': '#f3f3f3',
    'foreground': '#333333', 'focusBorder': '#0090f1',
    'list.hoverBackground': '#e8e8e8',
  },
  tokenColors: [
    { scope: 'comment', settings: { foreground: '#008000', fontStyle: 'italic' } },
    { scope: ['string.quoted', 'string.template'], settings: { foreground: '#a31515' } },
    { scope: 'keyword.control, storage.type', settings: { foreground: '#0000ff' } },
    { settings: { foreground: '#333333' } }, // scope 없음 = 전역 기본 → rules 제외
    { scope: 'invalid.token', settings: {} }, // foreground/fontStyle 없음 → 제외
  ],
};

describe('convertTheme', () => {
  it('kind/base 판별과 rules 생성 (배열/쉼표 scope 전개, # 제거)', () => {
    const t = convertTheme(sample)!;
    expect(t.kind).toBe('light');
    expect(t.monacoTheme.base).toBe('vs');
    expect(t.monacoTheme.inherit).toBe(true);
    const tokens = t.monacoTheme.rules.map((r) => r.token);
    expect(tokens).toEqual(['comment', 'string.quoted', 'string.template', 'keyword.control', 'storage.type']);
    expect(t.monacoTheme.rules[0]).toEqual({ token: 'comment', foreground: '008000', fontStyle: 'italic' });
    expect(t.monacoTheme.rules[1].foreground).toBe('a31515');
  });

  it('monacoTheme.colors에 editor.* 색 전달 + uiVars 매핑표 적용', () => {
    const t = convertTheme(sample)!;
    expect(t.monacoTheme.colors['editor.background']).toBe('#ffffff');
    expect(t.uiVars['--bg']).toBe('#ffffff');
    expect(t.uiVars['--bg-panel']).toBe('#f3f3f3');
    expect(t.uiVars['--fg']).toBe('#333333');
    expect(t.uiVars['--accent']).toBe('#0090f1');
    expect(t.uiVars['--bg-hover']).toBe('#e8e8e8');
    expect(t.uiVars['--warn']).toBeUndefined(); // 원본에 없음 → 생략(기존 CSS 기본값 유지)
  });

  it('type 없으면 dark, 손상 입력은 null', () => {
    expect(convertTheme({ name: 'x', colors: {}, tokenColors: [] })!.kind).toBe('dark');
    expect(convertTheme(null)).toBeNull();
    expect(convertTheme({ tokenColors: 'oops' })).toBeNull();
    expect(convertTheme('not object')).toBeNull();
  });

  it('번들 테마 4종 실변환 스모크', () => {
    for (const f of ['dark-plus.json', 'light-plus.json', 'monokai.json', 'one-dark-pro.json']) {
      const raw = JSON.parse(fs.readFileSync(`src/renderer/assets/themes/${f}`, 'utf8'));
      const t = convertTheme(raw);
      expect(t, f).not.toBeNull();
      expect(t!.monacoTheme.rules.length, f).toBeGreaterThan(5);
      expect(t!.uiVars['--bg'], f).toBeTruthy();
    }
    expect(convertTheme(JSON.parse(fs.readFileSync('src/renderer/assets/themes/light-plus.json', 'utf8')))!.kind).toBe('light');
  });
});
