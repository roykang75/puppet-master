import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt, CHAT_MAX_TOKENS } from '../src/main/chat/prompt';
import type { ChatContext } from '../src/shared/protocol';

const ctx: ChatContext = {
  path: 'src/app.ts', languageId: 'typescript',
  code: 'function add(a, b) {\n  return a + b;\n}', isSelection: true, startLine: 10,
  signatures: ['function add(a, b)', 'class App'],
};

describe('buildChatSystemPrompt', () => {
  it('컨텍스트 없으면 기본 지시만', () => {
    const s = buildChatSystemPrompt(null);
    expect(s).toContain('코드 어시스턴트');
    expect(s).toContain('한국어');
    expect(s).not.toContain('```');
  });

  it('컨텍스트 포함: 경로/언어/선택 표시/시작 줄/코드 블록/시그니처', () => {
    const s = buildChatSystemPrompt(ctx);
    expect(s).toContain('src/app.ts');
    expect(s).toContain('typescript');
    expect(s).toContain('선택 영역');
    expect(s).toContain('10행부터');
    expect(s).toContain('```typescript\nfunction add(a, b) {');
    expect(s).toContain('- function add(a, b)');
    expect(s).toContain('- class App');
  });

  it('선택이 아니면 "커서 주변" 표기, 시그니처 없으면 목록 생략', () => {
    const s = buildChatSystemPrompt({ ...ctx, isSelection: false, signatures: [] });
    expect(s).toContain('커서 주변');
    expect(s).not.toContain('심볼 시그니처');
  });

  it('자동 검색 스니펫: 심볼은 위치+시그니처, 텍스트는 위치+조각', () => {
    const s = buildChatSystemPrompt({
      retrieved: [
        { path: 'src/util.ts', line: 12, signature: 'function parse(x)', snippet: 'function parse(x)' },
        { path: 'src/misc.ts', snippet: 'const y = cache.get(k)' },
      ],
    });
    expect(s).toContain('자동 검색으로 찾은 코드');
    expect(s).toContain('src/util.ts:12 — function parse(x)');
    expect(s).toContain('src/misc.ts: const y = cache.get(k)');
  });

  it('스택 요약 섹션 렌더', () => {
    const s = buildChatSystemPrompt({ stack: '언어: TypeScript · 라이브러리: react@18.3.1' });
    expect(s).toContain('이 프로젝트의 스택(참고): 언어: TypeScript');
  });

  it('활성 파일 없이 검색 스니펫만 있어도 렌더', () => {
    const s = buildChatSystemPrompt({ retrieved: [{ path: 'a.ts', snippet: 's' }] });
    expect(s).not.toContain('사용자가 보고 있는 코드');
    expect(s).toContain('자동 검색으로 찾은 코드');
  });

  it('상수', () => {
    expect(CHAT_MAX_TOKENS).toBe(2048);
  });
});
