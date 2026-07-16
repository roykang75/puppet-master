import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { LANGUAGES } from '../src/indexer/languages';

const lang = (id: string) => LANGUAGES.find((l) => l.id === id)!;
const refsOf = (src: string, id: string, kind: string) =>
  extractFile(src, lang(id)).refs.filter((r) => r.kind === kind).map((r) => r.name);

describe('imports 추출', () => {
  it('C: 로컬/시스템 include (따옴표·꺾쇠 제거)', () => {
    const src = '#include "util.h"\n#include <stdio.h>\nint main() { return 0; }\n';
    expect(refsOf(src, 'c', 'import').sort()).toEqual(['stdio.h', 'util.h']);
  });
  it('TS: import/export-from 소스 (따옴표 제거)', () => {
    const src = `import { a } from './a';\nexport { b } from '../lib/b';\nconst x = 1;\n`;
    expect(refsOf(src, 'typescript', 'import').sort()).toEqual(['../lib/b', './a']);
  });
  it('Python: import / from-import (상대 포함)', () => {
    const src = 'import os.path\nfrom mypkg.mod import thing\n';
    expect(refsOf(src, 'python', 'import').sort()).toEqual(['mypkg.mod', 'os.path']);
  });
  it('Java: import 선언', () => {
    const src = 'import java.util.List;\nclass A {}\n';
    expect(refsOf(src, 'java', 'import')).toEqual(['java.util.List']);
  });
});

describe('extends 추출 (enclosing = 자식 클래스)', () => {
  it('TS: extends + implements, 제네릭 부모', () => {
    const src = `class Base<T> {}\ninterface IFoo {}\nclass Child extends Base<number> implements IFoo { m() { return 1; } }\n`;
    const res = extractFile(src, lang('typescript'));
    const ext = res.refs.filter((r) => r.kind === 'extends');
    const names = ext.map((r) => r.name).sort();
    expect(names).toEqual(['Base', 'IFoo']);
    // enclosing이 자식 클래스(Child)인지 — enclosingIndex → symbols
    for (const r of ext) {
      expect(r.enclosingIndex).not.toBeNull();
      expect(res.symbols[r.enclosingIndex!].name).toBe('Child');
    }
  });
  it('Java: superclass + interface', () => {
    const src = 'class Base {}\ninterface IFoo {}\nclass Child extends Base implements IFoo {}\n';
    expect(refsOf(src, 'java', 'extends').sort()).toEqual(['Base', 'IFoo']);
  });
  it('C++: base_class_clause', () => {
    const src = 'class Base {};\nclass Child : public Base { int x; };\n';
    expect(refsOf(src, 'cpp', 'extends')).toEqual(['Base']);
  });
  it('Python: superclass (qualified는 최내부 식별자)', () => {
    const src = 'class Base:\n    pass\n\nclass Child(Base):\n    pass\n';
    expect(refsOf(src, 'python', 'extends')).toEqual(['Base']);
  });
});

describe('기존 call 추출 회귀 없음', () => {
  it('C: call refs 유지', () => {
    const src = 'int helper() { return 1; }\nint main() { return helper(); }\n';
    expect(refsOf(src, 'c', 'call')).toContain('helper');
  });
});
