import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { LANGUAGES } from '../src/indexer/languages';

const lang = (id: string) => LANGUAGES.find((l) => l.id === id)!;

describe('심볼 이름 위치 (nameLine/nameCol)', () => {
  it('TS: 이름 식별자 위치는 def 노드 시작과 다르다', () => {
    const src = 'export function alpha() { return 1; }\n';
    const s = extractFile(src, lang('typescript')).symbols.find((x) => x.name === 'alpha')!;
    expect(s.nameLine).toBe(0);
    expect(s.nameCol).toBe(src.indexOf('alpha')); // 16 — 'export function ' 뒤
    expect(s.nameCol).not.toBe(s.startCol);
  });
  it('C: 함수 이름 위치', () => {
    const src = 'int main_fn() { return 0; }\n';
    const s = extractFile(src, lang('c')).symbols.find((x) => x.name === 'main_fn')!;
    expect(s.nameLine).toBe(0);
    expect(s.nameCol).toBe(4);
  });
  it('Python: 클래스 이름 위치 (둘째 줄)', () => {
    const src = '# c\nclass Foo:\n    pass\n';
    const s = extractFile(src, lang('python')).symbols.find((x) => x.name === 'Foo')!;
    expect(s.nameLine).toBe(1);
    expect(s.nameCol).toBe(6);
  });
});
