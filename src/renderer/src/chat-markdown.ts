/** 채팅 응답용 마크다운 서브셋 파서 (순수) — ChatPanel이 블록을 React 엘리먼트로 렌더한다.
 * 지원: 제목(#~####), 굵게/기울임/인라인 코드, 코드 펜스, 목록(-,*,•,숫자.) + 들여쓰기, 구분선.
 * HTML을 생성하지 않으므로 sanitize가 필요 없다. */

export type InlineSpan = { kind: 'text' | 'code' | 'bold' | 'italic'; text: string };
export type ListItem = { depth: number; spans: InlineSpan[] };
export type TableAlign = 'left' | 'center' | 'right';
export type Block =
  | { kind: 'para'; spans: InlineSpan[] }
  | { kind: 'heading'; level: number; spans: InlineSpan[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; header: InlineSpan[][]; rows: InlineSpan[][][]; aligns: TableAlign[] }
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
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s][^*\n]*?\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1]) spans.push({ kind: 'code', text: m[1].slice(1, -1) });
    else if (m[2]) spans.push({ kind: 'bold', text: m[2].slice(2, -2) });
    else spans.push({ kind: 'italic', text: m[3].slice(1, -1) });
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
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      // 스트리밍 중 닫는 펜스가 아직 없으면 끝까지 코드로 취급
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'code', lang: fence[1], text: body.join('\n') });
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
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara();
      blocks.push({ kind: 'heading', level: heading[1].length, spans: parseInline(heading[2]) });
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
      const item: ListItem = { depth: Math.min(2, Math.floor(m2[1].length / 2)), spans: parseInline(m2[2]) };
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
