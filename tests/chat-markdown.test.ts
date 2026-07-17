import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline } from '../src/renderer/src/chat-markdown';

describe('parseInline', () => {
  it('plain text is a single span', () => {
    expect(parseInline('그냥 텍스트')).toEqual([{ kind: 'text', text: '그냥 텍스트' }]);
  });

  it('parses inline code, bold, italic mixed with text', () => {
    expect(parseInline('선제 정리는 `docker prune`을 **먼저** 실행하고 *참고*하세요')).toEqual([
      { kind: 'text', text: '선제 정리는 ' },
      { kind: 'code', text: 'docker prune' },
      { kind: 'text', text: '을 ' },
      { kind: 'bold', text: '먼저' },
      { kind: 'text', text: ' 실행하고 ' },
      { kind: 'italic', text: '참고' },
      { kind: 'text', text: '하세요' },
    ]);
  });

  it('bold takes precedence over italic', () => {
    expect(parseInline('**굵게**')).toEqual([{ kind: 'bold', text: '굵게' }]);
  });

  it('parses links as clickable spans', () => {
    expect(parseInline('자세한 건 [문서](https://a.io/b) 참고')).toEqual([
      { kind: 'text', text: '자세한 건 ' },
      { kind: 'link', text: '문서', href: 'https://a.io/b' },
      { kind: 'text', text: ' 참고' },
    ]);
  });

  it('underscore emphasis works at word boundaries but not inside snake_case', () => {
    expect(parseInline('_기울임_ 그리고 __굵게__')).toEqual([
      { kind: 'italic', text: '기울임' },
      { kind: 'text', text: ' 그리고 ' },
      { kind: 'bold', text: '굵게' },
    ]);
    // 식별자 오탐 금지
    expect(parseInline('const my_var_name = 1')).toEqual([{ kind: 'text', text: 'const my_var_name = 1' }]);
  });

  it('parses strikethrough', () => {
    expect(parseInline('~~취소~~ 유지')).toEqual([
      { kind: 'strike', text: '취소' },
      { kind: 'text', text: ' 유지' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings level 1-6', () => {
    const blocks = parseMarkdown('## 후속 처리\n#### Deploy via SSH\n##### 소제목\n###### 미세제목');
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, spans: [{ kind: 'text', text: '후속 처리' }] },
      { kind: 'heading', level: 4, spans: [{ kind: 'text', text: 'Deploy via SSH' }] },
      { kind: 'heading', level: 5, spans: [{ kind: 'text', text: '소제목' }] },
      { kind: 'heading', level: 6, spans: [{ kind: 'text', text: '미세제목' }] },
    ]);
  });

  it('parses blockquotes merging consecutive lines', () => {
    const blocks = parseMarkdown('> 참고: 중요\n> 두 번째 줄\n\n일반 문단');
    expect(blocks.map((b) => b.kind)).toEqual(['quote', 'para']);
    const q = blocks[0];
    if (q.kind !== 'quote') return;
    expect(q.spans[0].text).toBe('참고: 중요\n두 번째 줄');
  });

  it('parses task list checkboxes', () => {
    const blocks = parseMarkdown('- [ ] 할 일\n- [x] 완료됨');
    const list = blocks[0];
    if (list.kind !== 'list') return;
    expect(list.items[0].checked).toBe(false);
    expect(list.items[0].spans[0].text).toBe('할 일');
    expect(list.items[1].checked).toBe(true);
    expect(list.items[1].spans[0].text).toBe('완료됨');
  });

  it('groups consecutive bullets into one list with depth from indent', () => {
    const blocks = parseMarkdown('- 항목1\n- 항목2\n  - 중첩');
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list.kind).toBe('list');
    if (list.kind !== 'list') return;
    expect(list.ordered).toBe(false);
    expect(list.items.map((i) => i.depth)).toEqual([0, 0, 1]);
  });

  it('separates ordered and unordered lists', () => {
    const blocks = parseMarkdown('1. 첫째\n2. 둘째\n- 불릿');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'list']);
    if (blocks[0].kind !== 'list' || blocks[1].kind !== 'list') return;
    expect(blocks[0].ordered).toBe(true);
    expect(blocks[0].items).toHaveLength(2);
    expect(blocks[1].ordered).toBe(false);
  });

  it('parses hr and paragraphs split by blank lines', () => {
    const blocks = parseMarkdown('첫 문단\n둘째 줄\n\n---\n\n다음 문단');
    expect(blocks).toEqual([
      { kind: 'para', spans: [{ kind: 'text', text: '첫 문단\n둘째 줄' }] },
      { kind: 'hr' },
      { kind: 'para', spans: [{ kind: 'text', text: '다음 문단' }] },
    ]);
  });

  it('parses fenced code with language', () => {
    const blocks = parseMarkdown('앞\n```ts\nconst a = 1;\n```\n뒤');
    expect(blocks).toEqual([
      { kind: 'para', spans: [{ kind: 'text', text: '앞' }] },
      { kind: 'code', lang: 'ts', text: 'const a = 1;' },
      { kind: 'para', spans: [{ kind: 'text', text: '뒤' }] },
    ]);
  });

  it('treats an unclosed fence as code to the end (streaming)', () => {
    const blocks = parseMarkdown('```\nstill typing');
    expect(blocks).toEqual([{ kind: 'code', lang: '', text: 'still typing' }]);
  });

  it('parses indented fences (목록/설명 아래 들여쓴 펜스) and dedents the body', () => {
    const blocks = parseMarkdown('실행 방법:\n\n    ```bash\n    python gugudan_app.py\n    ```\n\n끝');
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'code', 'para']);
    const code = blocks[1];
    if (code.kind !== 'code') return;
    expect(code.lang).toBe('bash');
    expect(code.text).toBe('python gugudan_app.py');
  });

  it('accepts non-word chars in fence language (c++, c#, objective-c)', () => {
    const blocks = parseMarkdown('```c++\nint x;\n```');
    expect(blocks).toEqual([{ kind: 'code', lang: 'c++', text: 'int x;' }]);
  });

  it('does not confuse hr with a bullet', () => {
    const blocks = parseMarkdown('- 항목\n---');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'hr']);
  });

  it('parses a GFM table with alignment and inline formatting', () => {
    const blocks = parseMarkdown('| 이름 | 값 |\n|:---|---:|\n| **a** | `1` |\n| b | 2 |\n\n뒤 문단');
    expect(blocks.map((b) => b.kind)).toEqual(['table', 'para']);
    const t = blocks[0];
    if (t.kind !== 'table') return;
    expect(t.aligns).toEqual(['left', 'right']);
    expect(t.header.map((c) => c[0].text)).toEqual(['이름', '값']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0][0]).toEqual({ kind: 'bold', text: 'a' });
    expect(t.rows[0][1][0]).toEqual({ kind: 'code', text: '1' });
  });

  it('a pipe line without a delimiter row stays a paragraph', () => {
    const blocks = parseMarkdown('a | b\n그냥 텍스트');
    expect(blocks.map((b) => b.kind)).toEqual(['para']);
  });
});
