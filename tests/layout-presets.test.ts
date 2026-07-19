import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Persistence } from '../src/main/persistence';

let dir: string;
let p: Persistence;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-lp-'));
  p = new Persistence(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Persistence layout presets', () => {
  it('없으면 빈 객체', () => {
    expect(p.loadLayoutPresets()).toEqual({});
  });

  it('저장→로드 라운드트립 (그룹/패널 퍼센트)', () => {
    const presets = {
      '집중': { 'main-h': { side: 0, main: 100 }, 'root-v': { top: 80, bottom: 20 } },
      '기본': { 'main-h': { side: 20, main: 80 } },
    };
    p.saveLayoutPresets(presets);
    expect(p.loadLayoutPresets()).toEqual(presets);
  });

  it('전역(프로젝트 무관) — 파일 1개', () => {
    p.saveLayoutPresets({ a: { g: { x: 50, y: 50 } } });
    expect(fs.existsSync(path.join(dir, 'layout-presets.json'))).toBe(true);
  });
});
