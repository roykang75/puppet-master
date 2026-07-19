import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Persistence } from '../src/main/persistence';

let dir: string;
let p: Persistence;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-review-state-'));
  p = new Persistence(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Persistence 리뷰 상태 (Plan 22)', () => {
  it('없으면 기본값 { baseline: null, reviewed: [] }', () => {
    expect(p.loadReviewState('/proj')).toEqual({ baseline: null, reviewed: [] });
  });

  it('저장→로드 라운드트립', () => {
    const state = { baseline: 'abc123', reviewed: ['src/a.ts#foo', 'src/b.ts'] };
    p.saveReviewState('/proj', state);
    expect(p.loadReviewState('/proj')).toEqual(state);
  });

  it('프로젝트별 격리 (해시 파일 분리)', () => {
    p.saveReviewState('/proj-a', { baseline: 'aaa', reviewed: ['x#y'] });
    p.saveReviewState('/proj-b', { baseline: 'bbb', reviewed: [] });
    expect(p.loadReviewState('/proj-a').baseline).toBe('aaa');
    expect(p.loadReviewState('/proj-b').baseline).toBe('bbb');
  });
});
