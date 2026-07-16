import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  postProcess,
  STOP_SEQUENCES,
  MAX_COMPLETION_TOKENS,
  type BuiltContext,
} from '../src/main/completion/prompt';

function ctx(over: Partial<BuiltContext> = {}): BuiltContext {
  return {
    path: 'src/app.ts',
    languageId: 'typescript',
    prefix: 'const x = 1;\n',
    suffix: '\nconsole.log(x);',
    symbolSignatures: [],
    ...over,
  };
}

describe('buildSystemPrompt', () => {
  it('언어/경로를 포함하고 마크다운 펜스 금지 지시를 담는다', () => {
    const sys = buildSystemPrompt(ctx({ languageId: 'python', path: 'a/b.py' }));
    expect(sys).toContain('python');
    expect(sys).toContain('a/b.py');
    expect(sys.toLowerCase()).toContain('markdown');
  });

  it('시그니처가 있을 때만 시그니처 목록을 포함한다', () => {
    const withSigs = buildSystemPrompt(ctx({ symbolSignatures: ['function foo(a: number): void', 'class Bar'] }));
    expect(withSigs).toContain('function foo(a: number): void');
    expect(withSigs).toContain('class Bar');

    const withoutSigs = buildSystemPrompt(ctx({ symbolSignatures: [] }));
    // 시그니처가 없으면 개별 시그니처 텍스트가 없어야 한다
    expect(withoutSigs).not.toContain('function foo');
  });
});

describe('buildUserPrompt', () => {
  it('<CURSOR> 마커를 prefix와 suffix 사이에 넣는다', () => {
    const u = buildUserPrompt(ctx({ prefix: 'AAA', suffix: 'BBB' }));
    expect(u).toContain('<CURSOR>');
    expect(u.indexOf('AAA')).toBeLessThan(u.indexOf('<CURSOR>'));
    expect(u.indexOf('<CURSOR>')).toBeLessThan(u.indexOf('BBB'));
  });

  it('prefix는 마지막 50줄, suffix는 앞 10줄로 절단한다', () => {
    const prefix = Array.from({ length: 80 }, (_, i) => `p${i}`).join('\n');
    const suffix = Array.from({ length: 30 }, (_, i) => `s${i}`).join('\n');
    const u = buildUserPrompt(ctx({ prefix, suffix }));
    // prefix 초반(잘려나간 부분)은 없어야
    expect(u).not.toContain('p0\n');
    expect(u).toContain('p79');
    // suffix 마지막(잘려나간 부분)은 없어야
    expect(u).toContain('s0');
    expect(u).not.toContain('s29');
    const cur = u.indexOf('<CURSOR>');
    const beforeCur = u.slice(0, cur);
    const afterCur = u.slice(cur);
    expect(beforeCur.split('\n').length).toBeLessThanOrEqual(51);
    expect(afterCur.split('\n').length).toBeLessThanOrEqual(11);
  });
});

describe('postProcess', () => {
  it('마크다운 펜스를 제거하고 내부 코드만 남긴다', () => {
    const raw = '```ts\nreturn 42;\n```';
    expect(postProcess(raw, '')).toBe('return 42;');
  });

  it('언어 태그 없는 펜스도 제거한다', () => {
    const raw = '```\nfoo();\n```';
    expect(postProcess(raw, '')).toBe('foo();');
  });

  it('공백뿐이면 null을 반환한다', () => {
    expect(postProcess('   \n  \n', '')).toBeNull();
    expect(postProcess('```\n\n```', '')).toBeNull();
  });

  it('raw 선두가 prefixTail 접미와 정확히 중복되면 그만큼 제거한다', () => {
    // prefixTail이 "const foo = "로 끝나고 raw가 "const foo = bar()"로 시작 → 겹침 "const foo = " 제거
    const prefixTail = 'x = 1;\nconst foo = ';
    const raw = 'const foo = bar();';
    expect(postProcess(raw, prefixTail)).toBe('bar();');
  });

  it('가장 긴 겹침을 제거한다 (부분 토큰 겹침)', () => {
    const prefixTail = 'return fo';
    const raw = 'foo();';
    // "fo"가 겹침 → "o();" 남음
    expect(postProcess(raw, prefixTail)).toBe('o();');
  });

  it('겹침이 없으면 원본을 그대로(트림) 유지한다', () => {
    const prefixTail = 'const a = ';
    const raw = 'compute();';
    expect(postProcess(raw, prefixTail)).toBe('compute();');
  });

  it('상수 값', () => {
    expect(STOP_SEQUENCES).toEqual(['\n\n\n', '```']);
    expect(MAX_COMPLETION_TOKENS).toBe(160);
  });
});
