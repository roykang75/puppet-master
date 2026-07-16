import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsStore, SettingsCrypto } from '../src/main/settings';

// prefix 기반 fake crypto — isAvailable 스위치 + decrypt throw 토글
class FakeCrypto implements SettingsCrypto {
  available = true;
  failDecrypt = false;
  isAvailable(): boolean {
    return this.available;
  }
  encrypt(plain: string): Buffer {
    return Buffer.from('enc:' + plain, 'utf8');
  }
  decrypt(enc: Buffer): string {
    if (this.failDecrypt) throw new Error('decrypt 실패');
    const s = enc.toString('utf8');
    if (!s.startsWith('enc:')) throw new Error('형식 오류');
    return s.slice('enc:'.length);
  }
}

let baseDir: string;
let crypto: FakeCrypto;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-settings-'));
  crypto = new FakeCrypto();
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('(a) set→get 라운드트립 + toPublic hasApiKey true', () => {
    const store = new SettingsStore(baseDir, crypto);
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
    // 파일에 평문 키가 저장되지 않았는지
    const raw = fs.readFileSync(path.join(baseDir, 'settings.json'), 'utf8');
    expect(raw).not.toContain('sk-123');
  });

  it('(b) apiKey 미전달 set은 기존 키 유지', () => {
    const store = new SettingsStore(baseDir, crypto);
    store.setCompletion({ provider: 'openai', model: 'qwen' }, 'sk-keep');
    store.setCompletion({ provider: 'openai', model: 'qwen', baseURL: 'http://localhost:1234' });
    expect(store.getApiKey()).toBe('sk-keep');
    expect(store.getCompletion().baseURL).toBe('http://localhost:1234');
    expect(store.toPublic().hasApiKey).toBe(true);
  });

  it('(c) 빈 문자열 apiKey는 키 삭제', () => {
    const store = new SettingsStore(baseDir, crypto);
    store.setCompletion({ provider: 'anthropic', model: 'm' }, 'sk-del');
    store.setCompletion({ provider: 'anthropic', model: 'm' }, '');
    expect(store.getApiKey()).toBeNull();
    expect(store.toPublic().hasApiKey).toBe(false);
  });

  it('(d) decrypt throw → getApiKey null + toPublic hasApiKey false', () => {
    const store = new SettingsStore(baseDir, crypto);
    store.setCompletion({ provider: 'anthropic', model: 'm' }, 'sk-x');
    crypto.failDecrypt = true;
    // 새 인스턴스로도 동일 (파일에서 로드) — 조용히 강등, throw 아님
    const store2 = new SettingsStore(baseDir, crypto);
    expect(store2.getApiKey()).toBeNull();
    expect(store2.toPublic().hasApiKey).toBe(false);
  });

  it('(e) isAvailable false에서 apiKey 저장 → throw', () => {
    const store = new SettingsStore(baseDir, crypto);
    crypto.available = false;
    expect(() => store.setCompletion({ provider: 'anthropic', model: 'm' }, 'sk-x')).toThrow();
    // 키 없는 저장은 여전히 허용
    expect(() => store.setCompletion({ provider: 'anthropic', model: 'm' })).not.toThrow();
  });

  it('(f) 파일 없음 → 기본값', () => {
    const store = new SettingsStore(baseDir, crypto);
    expect(store.getCompletion()).toEqual({ provider: 'none', model: '' });
    expect(store.getApiKey()).toBeNull();
    expect(store.toPublic()).toEqual({ provider: 'none', model: '', baseURL: undefined, hasApiKey: false });
  });

  it('손상된 JSON → 기본값 (throw 아님)', () => {
    fs.writeFileSync(path.join(baseDir, 'settings.json'), '{ not json');
    const store = new SettingsStore(baseDir, crypto);
    expect(store.getCompletion()).toEqual({ provider: 'none', model: '' });
  });
});
