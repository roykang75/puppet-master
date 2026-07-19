import { describe, it, expect } from 'vitest';
import { normalizeSearchSeed } from '../src/renderer/src/search-seed';

describe('normalizeSearchSeed', () => {
  it('단일 단어는 그대로', () => {
    expect(normalizeSearchSeed('helper_fn')).toBe('helper_fn');
  });
  it('앞뒤 공백은 트림', () => {
    expect(normalizeSearchSeed('  foo  ')).toBe('foo');
  });
  it('여러 줄이면 첫 줄만', () => {
    expect(normalizeSearchSeed('first line\nsecond line')).toBe('first line');
  });
  it('200자 캡 (트림 후)', () => {
    const long = 'a'.repeat(500);
    expect(normalizeSearchSeed(long)).toBe('a'.repeat(200));
  });
  it('null → null', () => {
    expect(normalizeSearchSeed(null)).toBeNull();
  });
  it('빈 문자열 → null', () => {
    expect(normalizeSearchSeed('')).toBeNull();
  });
  it('공백만 → null', () => {
    expect(normalizeSearchSeed('   \t  ')).toBeNull();
  });
  it('첫 줄이 공백뿐이면 → null (뒷줄이 있어도)', () => {
    expect(normalizeSearchSeed('   \nreal')).toBeNull();
  });
});
