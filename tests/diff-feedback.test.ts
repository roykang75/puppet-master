import { describe, it, expect } from 'vitest';
import { composeDiffFeedback, type DiffAnnotation } from '../src/renderer/src/diff-feedback';

describe('composeDiffFeedback', () => {
  it('헤더/줄항목/푸터 구성 + line 오름차순 정렬', () => {
    const anns: DiffAnnotation[] = [
      { line: 141, lineText: 'return {...}', comment: '이 줄은 None을 반환해야 함' },
      { line: 12, lineText: 'import os', comment: '불필요한 import' },
    ];
    const out = composeDiffFeedback('backend/db.py', anns);
    expect(out).toBe(
      '`backend/db.py` 변경 제안 피드백:\n' +
        '- 12행 `import os`: 불필요한 import\n' +
        '- 141행 `return {...}`: 이 줄은 None을 반환해야 함\n' +
        '위 코멘트를 반영해서 수정해줘.',
    );
  });

  it('lineText는 트림 후 80자 절단', () => {
    const long = 'x'.repeat(200);
    const out = composeDiffFeedback('a.ts', [{ line: 1, lineText: '   ' + long + '   ', comment: 'c' }]);
    expect(out).toContain('`' + 'x'.repeat(80) + '`');
    expect(out).not.toContain('x'.repeat(81));
  });

  it('백틱 포함 lineText도 무해하게 출력 (이스케이프 없이 그대로)', () => {
    const out = composeDiffFeedback('a.ts', [{ line: 3, lineText: 'const s = `hi`', comment: '템플릿 리터럴' }]);
    expect(out).toContain('- 3행 `const s = `hi``: 템플릿 리터럴');
  });

  it('빈 배열이면 빈 문자열', () => {
    expect(composeDiffFeedback('a.ts', [])).toBe('');
  });
});
