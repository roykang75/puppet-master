import { describe, it, expect } from 'vitest';
import { deriveTitle } from '../src/shared/chat-title';

describe('deriveTitle', () => {
  it('짧은 메시지는 그대로, 공백 정리', () => {
    expect(deriveTitle('  구구단 만들어줘 ')).toBe('구구단 만들어줘');
    expect(deriveTitle('a\n\nb   c')).toBe('a b c');
  });
  it('30자 초과는 절단 + …', () => {
    const long = '가'.repeat(40);
    const t = deriveTitle(long);
    expect(t.length).toBe(31); // 30 + …
    expect(t.endsWith('…')).toBe(true);
  });
  it('빈 입력은 기본 제목', () => {
    expect(deriveTitle('   ')).toBe('새 대화');
  });
});
