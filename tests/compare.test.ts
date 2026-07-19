import { describe, it, expect } from 'vitest';
import { buildCompareDiff } from '../src/renderer/src/compare';

describe('buildCompareDiff', () => {
  it('경로/라벨/내용 구성 (basename 제목)', () => {
    const d = buildCompareDiff('src/a.ts', 'const a = 1', 'lib/b.ts', 'const a = 2');
    expect(d.path).toBe('src/a.ts ↔ lib/b.ts'); // 고유 키(양쪽 rel)
    expect(d.label).toBe('비교: a.ts ↔ b.ts'); // 제목은 basename
    expect(d.before).toBe('const a = 1');
    expect(d.after).toBe('const a = 2');
  });

  it('루트 파일(경로 구분자 없음)도 basename 처리', () => {
    const d = buildCompareDiff('x.c', 'A', 'y.c', 'B');
    expect(d.label).toBe('비교: x.c ↔ y.c');
    // 마지막 세그먼트가 .c로 끝나 DiffView 언어 추정이 c로 잡힘
    expect(d.path.endsWith('y.c')).toBe(true);
  });
});
