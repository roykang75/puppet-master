import type { SymbolHit } from '../../indexer/api';
import type { FileRefRow } from '../../shared/protocol';

// 순수 모듈 — monaco 임포트 금지. Range 변환/데코 적용은 EditorPane에서만.

export interface TokenDecoration {
  line: number;
  col: number;
  length: number;
  className: string;
}

/** 심볼 kind(+scope) → CSS 클래스. 매핑 없으면 null(색칠 제외). */
function classFor(kind: string, scope: string): string | null {
  switch (kind) {
    case 'function':
    case 'method':
      return 'sem-func';
    case 'class':
    case 'struct':
    case 'interface':
    case 'type':
    case 'enum':
      return 'sem-type';
    case 'macro':
      return 'sem-macro';
    case 'namespace':
      return 'sem-ns';
    case 'field':
      return 'sem-member';
    case 'variable':
      return scope === '' ? 'sem-global' : 'sem-member';
    default:
      return null;
  }
}

/**
 * 심볼 정의(nameLine/nameCol)와 파일 내 참조(call/extends)를 색칠 데코로 변환 (0-기반).
 * 참조는 같은 파일에 동명 심볼이 있을 때만 그 클래스를 상속한다.
 */
export function buildTokenDecorations(symbols: SymbolHit[], refs: FileRefRow[]): TokenDecoration[] {
  const decos: TokenDecoration[] = [];
  const nameClass = new Map<string, string>();

  for (const s of symbols) {
    const className = classFor(s.kind, s.scope);
    if (!className) continue;
    decos.push({ line: s.nameLine, col: s.nameCol, length: s.name.length, className });
    if (!nameClass.has(s.name)) nameClass.set(s.name, className);
  }

  for (const r of refs) {
    const className = nameClass.get(r.name);
    if (!className) continue;
    decos.push({ line: r.line, col: r.col, length: r.name.length, className });
  }

  return decos;
}
