import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { languageForPath } from '../src/indexer/languages';

const C_SRC = `
#define MAX_SIZE 100
struct Widget { int id; };
int counter;
static int helper(int x) { return x * 2; }
int create_widget(int id) {
  counter++;
  return helper(id);
}
`;

const TS_SRC = `
export const MAX = 10;
interface Shape { area(): number; }
export class Circle {
  radius = 1;
  area(): number { return 3.14 * this.radius * this.radius; }
}
export function makeCircle(): Circle {
  const c = new Circle();
  console.log(c.area());
  return c;
}
`;

function byName(result: { symbols: { name: string; kind: string; scope: string }[] }, name: string) {
  return result.symbols.find((s) => s.name === name);
}

describe('extractFile (C)', () => {
  const spec = languageForPath('a.c')!;
  const r = extractFile(C_SRC, spec);

  it('extracts function, struct, macro, global variable', () => {
    expect(byName(r, 'create_widget')?.kind).toBe('function');
    expect(byName(r, 'helper')?.kind).toBe('function');
    expect(byName(r, 'Widget')?.kind).toBe('struct');
    expect(byName(r, 'MAX_SIZE')?.kind).toBe('macro');
    expect(byName(r, 'counter')?.kind).toBe('variable');
  });

  it('captures call refs with enclosing function', () => {
    const call = r.refs.find((x) => x.name === 'helper');
    expect(call).toBeDefined();
    expect(r.symbols[call!.enclosingIndex!].name).toBe('create_widget');
  });

  it('fills signature with first line of definition', () => {
    expect(byName(r, 'create_widget')?.name).toBe('create_widget');
    expect(r.symbols.find((s) => s.name === 'create_widget')!.signature).toContain('int create_widget(int id)');
  });
});

describe('extractFile (TypeScript)', () => {
  const spec = languageForPath('a.ts')!;
  const r = extractFile(TS_SRC, spec);

  it('extracts class, method, interface, function, const', () => {
    expect(byName(r, 'Circle')?.kind).toBe('class');
    expect(byName(r, 'area')?.kind).toBe('method');
    expect(byName(r, 'Shape')?.kind).toBe('interface');
    expect(byName(r, 'makeCircle')?.kind).toBe('function');
    expect(byName(r, 'MAX')?.kind).toBe('variable');
  });

  it('sets scope from enclosing class', () => {
    const area = r.symbols.find((s) => s.name === 'area' && s.kind === 'method');
    expect(area?.scope).toBe('Circle');
  });

  it('captures method call ref (c.area())', () => {
    expect(r.refs.some((x) => x.name === 'area')).toBe(true);
  });
});

describe('error tolerance', () => {
  it('extracts symbols from broken code', () => {
    const spec = languageForPath('b.c')!;
    const r = extractFile('int ok_func() { return 1; }\nint broken( {{{', spec);
    expect(byName(r, 'ok_func')?.kind).toBe('function');
  });
});

describe('languageForPath', () => {
  it('maps extensions', () => {
    expect(languageForPath('x.c')?.id).toBe('c');
    expect(languageForPath('x.ts')?.id).toBe('typescript');
    expect(languageForPath('x.tsx')?.id).toBe('tsx');
    expect(languageForPath('x.txt')).toBeNull();
  });
});
