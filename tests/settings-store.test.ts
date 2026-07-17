import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsStore } from '../src/main/settings';

// 평문 저장으로 전환됨 (사용자 결정) — safeStorage 크로스 인스턴스 복호화 실패 문제로 dev 환경에서 사용 불가했음.
// 대신 settings.json 파일 권한을 0600으로 제한한다.

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-settings-'));
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('(a) set→get 라운드트립 + toPublic hasApiKey true + 파일 권한 0600', () => {
    const store = new SettingsStore(baseDir);
    store.setCompletion({ provider: 'anthropic', model: 'claude-haiku-4-5' }, 'sk-123');
    const got = store.getCompletion();
    expect(got.provider).toBe('anthropic');
    expect(got.model).toBe('claude-haiku-4-5');
    expect(store.getApiKey()).toBe('sk-123');
    expect(store.toPublic()).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      baseURL: undefined,
      hasApiKey: true,
    });
    const file = path.join(baseDir, 'settings.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('(b) apiKey 미전달 set은 기존 키 유지', () => {
    const store = new SettingsStore(baseDir);
    store.setCompletion({ provider: 'openai', model: 'qwen' }, 'sk-keep');
    store.setCompletion({ provider: 'openai', model: 'qwen', baseURL: 'http://localhost:1234' });
    expect(store.getApiKey()).toBe('sk-keep');
    expect(store.getCompletion().baseURL).toBe('http://localhost:1234');
    expect(store.toPublic().hasApiKey).toBe(true);
  });

  it('(c) 빈 문자열 apiKey는 키 삭제', () => {
    const store = new SettingsStore(baseDir);
    store.setCompletion({ provider: 'anthropic', model: 'm' }, 'sk-del');
    store.setCompletion({ provider: 'anthropic', model: 'm' }, '');
    expect(store.getApiKey()).toBeNull();
    expect(store.toPublic().hasApiKey).toBe(false);
  });

  it('(d) 새 인스턴스가 파일에서 키를 그대로 읽는다', () => {
    const store = new SettingsStore(baseDir);
    store.setCompletion({ provider: 'openai', model: 'm' }, 'sk-cross');
    const store2 = new SettingsStore(baseDir);
    expect(store2.getApiKey()).toBe('sk-cross');
    expect(store2.toPublic().hasApiKey).toBe(true);
  });

  it('(e) 구버전 apiKeyEnc만 있는 파일 → 키 없음으로 취급 (재입력 유도)', () => {
    fs.writeFileSync(
      path.join(baseDir, 'settings.json'),
      JSON.stringify({ completion: { provider: 'openai', model: 'm', apiKeyEnc: 'AAAA' } }),
    );
    const store = new SettingsStore(baseDir);
    expect(store.getApiKey()).toBeNull();
    expect(store.toPublic().hasApiKey).toBe(false);
    expect(store.getCompletion().model).toBe('m');
  });

  it('(f) 파일 없음 → 기본값', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getCompletion()).toEqual({ provider: 'none', model: '' });
    expect(store.getApiKey()).toBeNull();
    expect(store.toPublic()).toEqual({ provider: 'none', model: '', baseURL: undefined, hasApiKey: false });
  });

  it('손상된 JSON → 기본값 (throw 아님)', () => {
    fs.writeFileSync(path.join(baseDir, 'settings.json'), '{ not json');
    const store = new SettingsStore(baseDir);
    expect(store.getCompletion()).toEqual({ provider: 'none', model: '' });
  });
});

describe('appearance', () => {
  it('기본값 dark-plus, set→get 라운드트립, completion과 독립', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getAppearance()).toEqual({ theme: 'dark-plus' });
    store.setAppearance({ theme: 'monokai' });
    expect(store.getAppearance()).toEqual({ theme: 'monokai' });
    store.setCompletion({ provider: 'none', model: '' });
    expect(store.getAppearance()).toEqual({ theme: 'monokai' }); // completion 저장이 appearance 보존
    const store2 = new SettingsStore(baseDir);
    expect(store2.getAppearance().theme).toBe('monokai');
  });
});
