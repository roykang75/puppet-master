import { describe, it, expect } from 'vitest';
import { buildTokenDecorations } from '../src/renderer/src/semantic-tokens';
import type { SymbolHit } from '../src/indexer/api';
import type { FileRefRow } from '../src/shared/protocol';

const sym = (over: Partial<SymbolHit>): SymbolHit => ({
  id: 1,
  name: 'x',
  kind: 'variable',
  scope: '',
  signature: '',
  path: 'a.ts',
  line: 0,
  nameLine: 0,
  nameCol: 0,
  ...over,
});

describe('buildTokenDecorations', () => {
  it('전역 variable(scope 없음) → sem-global, (nameLine,nameCol,name.length) 사용', () => {
    const decos = buildTokenDecorations([sym({ name: 'CONF', kind: 'variable', scope: '', nameLine: 3, nameCol: 6 })], []);
    expect(decos).toEqual([{ line: 3, col: 6, length: 4, className: 'sem-global' }]);
  });

  it('scope 있는 variable / field → sem-member', () => {
    const decos = buildTokenDecorations(
      [
        sym({ name: 'count', kind: 'variable', scope: 'go', nameLine: 1, nameCol: 2 }),
        sym({ name: 'size', kind: 'field', scope: 'Box', nameLine: 4, nameCol: 3 }),
      ],
      [],
    );
    expect(decos).toEqual([
      { line: 1, col: 2, length: 5, className: 'sem-member' },
      { line: 4, col: 3, length: 4, className: 'sem-member' },
    ]);
  });

  it('kind 매핑: function/method→sem-func, class/type/enum→sem-type, macro→sem-macro, namespace→sem-ns', () => {
    const decos = buildTokenDecorations(
      [
        sym({ name: 'run', kind: 'function', nameLine: 0, nameCol: 0 }),
        sym({ name: 'exec', kind: 'method', nameLine: 1, nameCol: 0 }),
        sym({ name: 'Box', kind: 'class', nameLine: 2, nameCol: 0 }),
        sym({ name: 'Id', kind: 'type', nameLine: 3, nameCol: 0 }),
        sym({ name: 'Mode', kind: 'enum', nameLine: 4, nameCol: 0 }),
        sym({ name: 'MAX', kind: 'macro', nameLine: 5, nameCol: 0 }),
        sym({ name: 'ns', kind: 'namespace', nameLine: 6, nameCol: 0 }),
      ],
      [],
    );
    expect(decos.map((d) => d.className)).toEqual([
      'sem-func', 'sem-func', 'sem-type', 'sem-type', 'sem-type', 'sem-macro', 'sem-ns',
    ]);
  });

  it('ref는 파일 내 동명 심볼의 클래스를 상속', () => {
    const symbols = [sym({ name: 'run', kind: 'function', nameLine: 0, nameCol: 9 })];
    const refs: FileRefRow[] = [{ name: 'run', kind: 'call', line: 5, col: 4 }];
    const decos = buildTokenDecorations(symbols, refs);
    expect(decos).toContainEqual({ line: 5, col: 4, length: 3, className: 'sem-func' });
  });

  it('파일 내 동명 심볼이 없는 ref는 제외', () => {
    const symbols = [sym({ name: 'run', kind: 'function', nameLine: 0, nameCol: 0 })];
    const refs: FileRefRow[] = [{ name: 'unknownExternal', kind: 'call', line: 2, col: 1 }];
    const decos = buildTokenDecorations(symbols, refs);
    expect(decos.some((d) => d.line === 2)).toBe(false);
    expect(decos.length).toBe(1);
  });

  it('매핑되지 않는 kind는 제외', () => {
    const decos = buildTokenDecorations([sym({ name: 'weird', kind: 'label', nameLine: 0, nameCol: 0 })], []);
    expect(decos).toEqual([]);
  });
});
