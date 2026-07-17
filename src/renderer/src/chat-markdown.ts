/** 채팅 응답용 마크다운 서브셋 파서 (순수) — ChatPanel이 블록을 React 엘리먼트로 렌더한다.
 * 지원: 제목(#~####), 굵게/기울임/인라인 코드, 코드 펜스, 목록(-,*,•,숫자.) + 들여쓰기, 구분선.
 * HTML을 생성하지 않으므로 sanitize가 필요 없다. */

export type InlineSpan =
  | { kind: 'text' | 'code' | 'bold' | 'italic' | 'strike'; text: string }
  | { kind: 'link'; text: string; href: string };
export type ListItem = { depth: number; spans: InlineSpan[]; checked?: boolean };
export type TableAlign = 'left' | 'center' | 'right';
export type Block =
  | { kind: 'para'; spans: InlineSpan[] }
  | { kind: 'heading'; level: number; spans: InlineSpan[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; header: InlineSpan[][]; rows: InlineSpan[][][]; aligns: TableAlign[] }
  | { kind: 'quote'; spans: InlineSpan[] }
  | { kind: 'hr' };

/** `| a | b |` → 셀 문자열 배열 (양끝 파이프 제거) */
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** GFM 구분행(`|:---|---:|`)이면 정렬 배열, 아니면 null */
function parseDelimiter(line: string): TableAlign[] | null {
  if (!line.includes('|') || !line.includes('-')) return null;
  const cells = splitRow(line);
  const aligns: TableAlign[] = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    aligns.push(c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left');
  }
  return aligns.length > 0 ? aligns : null;
}

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  // 순서: 코드 → 링크 → **굵게 → __굵게 → *기울임 → _기울임 → ~~취소선.
  // 언더스코어 강조는 단어 경계에서만 (snake_case 식별자 오탐 방지 — GFM 규칙)
  const re =
    /(`[^`\n]+`)|\[([^\]\n]+)\]\(([^)\s]+)\)|(\*\*[^*\n]+?\*\*)|(?<!\w)__([^_\n]+?)__(?!\w)|(\*[^*\s][^*\n]*?\*)|(?<!\w)_([^_\n]+?)_(?!\w)|(~~[^~\n]+?~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1]) spans.push({ kind: 'code', text: m[1].slice(1, -1) });
    else if (m[2] !== undefined) spans.push({ kind: 'link', text: m[2], href: m[3] });
    else if (m[4]) spans.push({ kind: 'bold', text: m[4].slice(2, -2) });
    else if (m[5] !== undefined) spans.push({ kind: 'bold', text: m[5] });
    else if (m[6]) spans.push({ kind: 'italic', text: m[6].slice(1, -1) });
    else if (m[7] !== undefined) spans.push({ kind: 'italic', text: m[7] });
    else spans.push({ kind: 'strike', text: m[8].slice(2, -2) });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) });
  return spans;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'para', spans: parseInline(para.join('\n')) });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 들여쓰인 펜스 허용 (모델이 목록/설명 아래에 펜스를 들여써 출력하는 패턴) + c++/c# 등 언어 태그
    const fence = line.match(/^(\s*)```([\w+#.-]*)\s*$/);
    if (fence) {
      flushPara();
      const indent = fence[1];
      const body: string[] = [];
      i++;
      // 스트리밍 중 닫는 펜스가 아직 없으면 끝까지 코드로 취급
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        // 여는 펜스와 같은 들여쓰기는 본문에서 제거 (펜스 기준 상대 들여쓰기 유지)
        body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
        i++;
      }
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    // GFM 테이블 — 파이프 행 + 다음 줄이 구분행일 때만
    if (line.includes('|') && i + 1 < lines.length) {
      const aligns = parseDelimiter(lines[i + 1]);
      if (aligns) {
        flushPara();
        const header = splitRow(line).map(parseInline);
        const rows: InlineSpan[][][] = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i]).map(parseInline));
          i++;
        }
        i--; // for 루프의 i++ 보정
        blocks.push({ kind: 'table', header, rows, aligns });
        continue;
      }
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      blocks.push({ kind: 'heading', level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    // 인용문 — 연속된 > 줄을 하나로 병합
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara();
      const qlines = [quote[1]];
      while (i + 1 < lines.length) {
        const nm = lines[i + 1].match(/^>\s?(.*)$/);
        if (!nm) break;
        qlines.push(nm[1]);
        i++;
      }
      blocks.push({ kind: 'quote', spans: parseInline(qlines.join('\n')) });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const ul = line.match(/^(\s*)[-*•]\s+(.*)$/);
    const ol = ul ? null : line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const m2 = (ul ?? ol)!;
      const ordered = !!ol;
      // 체크리스트: - [ ] / - [x]
      let content = m2[2];
      let checked: boolean | undefined;
      const task = ul ? content.match(/^\[([ xX])\]\s+(.*)$/) : null;
      if (task) {
        checked = task[1] !== ' ';
        content = task[2];
      }
      const item: ListItem = { depth: Math.min(2, Math.floor(m2[1].length / 2)), spans: parseInline(content) };
      if (checked !== undefined) item.checked = checked;
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === 'list' && prev.ordered === ordered) prev.items.push(item);
      else blocks.push({ kind: 'list', ordered, items: [item] });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}
