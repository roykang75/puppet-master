import { describe, it, expect } from 'vitest';
import { applyRenameToContent } from '../src/main/rename';

describe('applyRenameToContent', () => {
  it('같은 줄 다중 발생 (col desc로 오프셋 보존)', () => {
    const r = applyRenameToContent('foo(foo);\n', [{ line: 0, col: 0 }, { line: 0, col: 4 }], 'foo', 'barbar');
    expect(r.content).toBe('barbar(barbar);\n');
    expect(r.replaced).toBe(2);
    expect(r.skipped).toEqual([]);
  });
  it('위치 불일치는 skip 기록', () => {
    const r = applyRenameToContent('abc def\n', [{ line: 0, col: 4 }], 'xyz', 'q');
    expect(r.content).toBe('abc def\n');
    expect(r.skipped).toEqual([{ line: 0, col: 4 }]);
  });
  it('여러 줄, 범위 밖 줄은 skip', () => {
    const r = applyRenameToContent('a\nfoo\n', [{ line: 1, col: 0 }, { line: 9, col: 0 }], 'foo', 'z');
    expect(r.content).toBe('a\nz\n');
    expect(r.replaced).toBe(1);
    expect(r.skipped).toEqual([{ line: 9, col: 0 }]);
  });
});
