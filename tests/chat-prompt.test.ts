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

  it('상수', () => {
    expect(CHAT_MAX_TOKENS).toBe(2048);
  });
});
