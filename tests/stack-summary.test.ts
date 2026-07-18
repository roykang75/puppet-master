import { describe, it, expect } from 'vitest';
import { buildStackSummary } from '../src/shared/stack-summary';

describe('buildStackSummary', () => {
  it('언어 + 라이브러리(버전) 한 줄', () => {
    const s = buildStackSummary({ languages: ['TypeScript', 'CSS'], libraries: [{ name: 'react', version: '18.3.1' }, { name: 'vite' }] });
    expect(s).toContain('TypeScript');
    expect(s).toContain('react@18.3.1');
    expect(s).toContain('vite'); // 버전 없으면 이름만
  });
  it('빈 스택 → 빈 문자열', () => {
    expect(buildStackSummary({ languages: [], libraries: [] })).toBe('');
  });
});
