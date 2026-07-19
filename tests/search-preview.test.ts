import { describe, it, expect } from 'vitest';
import { buildPreviewSlice } from '../src/renderer/src/search-preview';

const content = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');

describe('buildPreviewSlice', () => {
  it('중앙: targetLine 기준 ±radius 줄', () => {
    const s = buildPreviewSlice(content, 15, 7);
    expect(s.startLine).toBe(8);
    expect(s.lines).toHaveLength(15); // 8..22
    expect(s.lines[0]).toBe('line8');
    expect(s.lines[s.lines.length - 1]).toBe('line22');
  });

  it('파일 시작 근처: 끝쪽으로 확장해 창(15줄) 유지', () => {
    const s = buildPreviewSlice(content, 2, 7);
    expect(s.startLine).toBe(1);
    expect(s.lines).toHaveLength(15);
    expect(s.lines[0]).toBe('line1');
    expect(s.lines[s.lines.length - 1]).toBe('line15'); // 1..15
  });

  it('파일 끝 근처: 시작쪽으로 확장해 창(15줄) 유지', () => {
    const s = buildPreviewSlice(content, 29, 7);
    expect(s.startLine).toBe(16);
    expect(s.lines).toHaveLength(15);
    expect(s.lines[s.lines.length - 1]).toBe('line30'); // 16..30
  });

  it('짧은 파일: 전체 반환', () => {
    const short = 'a\nb\nc';
    const s = buildPreviewSlice(short, 2, 7);
    expect(s.startLine).toBe(1);
    expect(s.lines).toEqual(['a', 'b', 'c']);
  });

  it('빈 내용: 한 줄(빈 문자열)', () => {
    const s = buildPreviewSlice('', 1, 7);
    expect(s.startLine).toBe(1);
    expect(s.lines).toEqual(['']);
  });

  it('radius=0: 대상 줄만', () => {
    const s = buildPreviewSlice(content, 10, 0);
    expect(s.startLine).toBe(10);
    expect(s.lines).toEqual(['line10']);
  });

  it('범위 밖 targetLine은 보정', () => {
    expect(buildPreviewSlice(content, 0, 2).startLine).toBe(1);
    const over = buildPreviewSlice(content, 999, 2);
    expect(over.lines[over.lines.length - 1]).toBe('line30');
  });

  it('기본 radius=30: 중앙 61줄 창', () => {
    const long = Array.from({ length: 100 }, (_, i) => `L${i + 1}`).join('\n');
    const s = buildPreviewSlice(long, 50);
    expect(s.startLine).toBe(20); // 50-30
    expect(s.lines).toHaveLength(61); // 20..80
    expect(s.lines[0]).toBe('L20');
    expect(s.lines[s.lines.length - 1]).toBe('L80');
  });
});
