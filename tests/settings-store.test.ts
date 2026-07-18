import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsStore } from '../src/main/settings';

// 평문 저장으로 전환됨 (사용자 결정) — safeStorage 크로스 인스턴스 복호화 실패 문제로 dev 환경에서 사용 불가했음.
// 대신 settings.json 파일 권한을 0600으로 제한한다.
// 프로파일 방식: provider+모델+서버+키 세트를 여러 개 등록, 활성 1개를 완성/채팅이 공유.

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-settings-'));
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe('SettingsStore 프로파일', () => {
  it('(a) setProfiles→활성 뷰 라운드트립 + toPublic + 파일 권한 0600', () => {
    const store = new SettingsStore(baseDir);
    store.setProfiles(
      [
        { name: '클로드', provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-123' },
        { name: '로컬', provider: 'openai', model: 'qwen', baseURL: 'http://localhost:1234/v1' },
      ],
      0,
    );
    expect(store.getCompletion()).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5', baseURL: undefined });
    expect(store.getApiKey()).toBe('sk-123');
    const pub = store.toPublic();
    expect(pub.provider).toBe('anthropic');
    expect(pub.hasApiKey).toBe(true);
    expect(pub.profiles).toHaveLength(2);
    expect(pub.profiles[0].name).toBe('클로드');
    expect(pub.profiles[1].hasApiKey).toBe(false);
    expect(pub.activeId).toBe(pub.profiles[0].id);
    // 키는 공개 뷰에 절대 포함되지 않는다
    expect(JSON.stringify(pub)).not.toContain('sk-123');
    const file = path.join(baseDir, 'settings.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('(b) apiKey undefined 재저장은 같은 id의 기존 키 유지, 빈 문자열은 삭제', () => {
    const store = new SettingsStore(baseDir);
    store.setProfiles([{ name: 'a', provider: 'openai', model: 'm', apiKey: 'sk-keep' }], 0);
    const id = store.toPublic().profiles[0].id;
    store.setProfiles([{ id, name: 'a', provider: 'openai', model: 'm', baseURL: 'http://x' }], 0);
    expect(store.getApiKey()).toBe('sk-keep');
    expect(store.getCompletion().baseURL).toBe('http://x');
    store.setProfiles([{ id, name: 'a', provider: 'openai', model: 'm', apiKey: '' }], 0);
    expect(store.getApiKey()).toBeNull();
  });

  it('(c) 활성 전환: setActiveProfile / activeIndex null = 사용 안 함', () => {
    const store = new SettingsStore(baseDir);
    store.setProfiles(
      [
        { name: 'a', provider: 'anthropic', model: 'm1', apiKey: 'k1' },
        { name: 'b', provider: 'openai', model: 'm2', apiKey: 'k2' },
      ],
      0,
    );
    const ids = store.toPublic().profiles.map((p) => p.id);
    store.setActiveProfile(ids[1]);
    expect(store.getCompletion()).toEqual({ provider: 'openai', model: 'm2', baseURL: undefined });
    expect(store.getApiKey()).toBe('k2');
    store.setActiveProfile(null);
    expect(store.getCompletion()).toEqual({ provider: 'none', model: '' });
    expect(store.toPublic().activeId).toBeNull();
    // 존재하지 않는 id → 사용 안 함으로 처리
    store.setActiveProfile('ghost');
    expect(store.toPublic().activeId).toBeNull();
  });

  it('(d) 새 인스턴스가 파일에서 프로파일/키를 그대로 읽는다', () => {
    const store = new SettingsStore(baseDir);
    store.setProfiles([{ name: 'a', provider: 'openai', model: 'm', apiKey: 'sk-cross' }], 0);
    const store2 = new SettingsStore(baseDir);
    expect(store2.getApiKey()).toBe('sk-cross');
    expect(store2.toPublic().profiles).toHaveLength(1);
  });

  it('(e) 목록에서 빠진 프로파일은 키와 함께 삭제된다', () => {
    const store = new SettingsStore(baseDir);
    store.setProfiles(
      [
        { name: 'a', provider: 'openai', model: 'm1', apiKey: 'k1' },
        { name: 'b', provider: 'openai', model: 'm2', apiKey: 'k2' },
      ],
      0,
    );
    const keep = store.toPublic().profiles[1];
    store.setProfiles([{ id: keep.id, name: 'b', provider: 'openai', model: 'm2' }], 0);
    const pub = store.toPublic();
    expect(pub.profiles).toHaveLength(1);
    expect(store.getApiKey()).toBe('k2'); // 남은 프로파일 키 유지
    expect(fs.readFileSync(path.join(baseDir, 'settings.json'), 'utf8')).not.toContain('k1');
  });

  it('(f) 파일 없음/손상 → 기본값 (프로파일 없음, provider none)', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getCompletion()).toEqual({ provider: 'none', model: '' });
    expect(store.getApiKey()).toBeNull();
    expect(store.toPublic().profiles).toEqual([]);
    fs.writeFileSync(path.join(baseDir, 'settings.json'), '{ not json');
    expect(new SettingsStore(baseDir).getCompletion()).toEqual({ provider: 'none', model: '' });
  });
});

describe('구버전 단일 설정 마이그레이션', () => {
  it('구버전 completion → 프로파일 1개(활성), 평문 키 승계', () => {
    fs.writeFileSync(
      path.join(baseDir, 'settings.json'),
      JSON.stringify({ completion: { provider: 'openai', model: 'qwen', baseURL: 'http://l:1234/v1', apiKey: 'sk-old' } }),
    );
    const store = new SettingsStore(baseDir);
    expect(store.getCompletion()).toEqual({ provider: 'openai', model: 'qwen', baseURL: 'http://l:1234/v1' });
    expect(store.getApiKey()).toBe('sk-old');
    const pub = store.toPublic();
    expect(pub.profiles).toHaveLength(1);
    expect(pub.profiles[0].name).toBe('qwen');
    expect(pub.activeId).toBe(pub.profiles[0].id);
  });

  it('구버전 apiKeyEnc(safeStorage 잔재)만 있으면 키 없음으로 취급 (재입력 유도)', () => {
    fs.writeFileSync(
      path.join(baseDir, 'settings.json'),
      JSON.stringify({ completion: { provider: 'openai', model: 'm', apiKeyEnc: 'AAAA' } }),
    );
    const store = new SettingsStore(baseDir);
    expect(store.getApiKey()).toBeNull();
    expect(store.toPublic().hasApiKey).toBe(false);
    expect(store.getCompletion().model).toBe('m');
  });

  it('구버전 provider none → 프로파일 없음', () => {
    fs.writeFileSync(
      path.join(baseDir, 'settings.json'),
      JSON.stringify({ completion: { provider: 'none', model: '' }, appearance: { theme: 'monokai' } }),
    );
    const store = new SettingsStore(baseDir);
    expect(store.toPublic().profiles).toEqual([]);
    expect(store.getAppearance().theme).toBe('monokai'); // appearance 보존
  });
});

describe('appearance', () => {
  it('기본값 dark-plus, set→get 라운드트립, 프로파일과 독립', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getAppearance()).toEqual({ theme: 'dark-plus' });
    store.setAppearance({ theme: 'monokai' });
    expect(store.getAppearance()).toEqual({ theme: 'monokai' });
    store.setProfiles([{ name: 'a', provider: 'openai', model: 'm' }], 0);
    expect(store.getAppearance()).toEqual({ theme: 'monokai' }); // 프로파일 저장이 appearance 보존
    const store2 = new SettingsStore(baseDir);
    expect(store2.getAppearance().theme).toBe('monokai');
  });
});

describe('Context7 API 키', () => {
  it('setContext7Key→toPublic.hasContext7Key, 값은 공개 객체에 없음', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getContext7Key()).toBeNull();
    expect(store.toPublic().hasContext7Key).toBe(false);
    store.setContext7Key('ctx7sk_x');
    expect(store.getContext7Key()).toBe('ctx7sk_x');
    const pub = store.toPublic();
    expect(pub.hasContext7Key).toBe(true);
    expect('context7ApiKey' in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('ctx7sk_x');
    // 빈 문자열 = 삭제
    store.setContext7Key('');
    expect(store.getContext7Key()).toBeNull();
    expect(store.toPublic().hasContext7Key).toBe(false);
  });
});

describe('agent 설정', () => {
  it('기본 allowedDirs [] , set→get 라운드트립, 프로파일과 독립', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getAgent()).toEqual({ allowedDirs: [] });
    store.setAgent({ allowedDirs: ['/Users/x/docs', '/tmp/ref'] });
    expect(store.getAgent()).toEqual({ allowedDirs: ['/Users/x/docs', '/tmp/ref'] });
    store.setProfiles([{ name: 'a', provider: 'openai', model: 'm' }], 0);
    expect(store.getAgent().allowedDirs).toHaveLength(2); // 프로파일 저장이 agent 보존
    expect(new SettingsStore(baseDir).getAgent().allowedDirs).toHaveLength(2);
  });
});
