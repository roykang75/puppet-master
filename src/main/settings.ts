import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { CompletionProfileInput, CompletionSettings } from '../shared/protocol';

// 서비스(completion/chat)가 소비하는 활성 프로파일 뷰 — 기존 형태 유지
export interface StoredCompletionSettings {
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
}

export interface CompletionProfile {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  apiKey?: string; // 평문 저장 (사용자 결정 — dev 환경에서 safeStorage 키체인 접근이 프로세스마다 달라 복호화가 깨지는 문제로 전환)
}

// 구버전(단일 설정) 파일 형태 — 읽기 시 프로파일 1개로 마이그레이션
interface LegacyCompletion {
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnc?: string; // safeStorage 암호화 잔재 — 더 이상 읽지 않음
}

interface SettingsFile {
  completion?: LegacyCompletion;
  profiles?: CompletionProfile[];
  activeProfileId?: string | null;
  appearance?: { theme: string };
  agent?: { allowedDirs: string[] };
  context7ApiKey?: string;
}

interface Normalized {
  profiles: CompletionProfile[];
  activeProfileId: string | null;
  appearance?: { theme: string };
  agent?: { allowedDirs: string[] };
  context7ApiKey?: string;
}

export class SettingsStore {
  constructor(private baseDir: string) {}

  private filePath(): string {
    return path.join(this.baseDir, 'settings.json');
  }

  private read(): Normalized {
    let raw: SettingsFile | null = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath(), 'utf8')) as SettingsFile;
    } catch {
      // 파일 없음/손상 → 기본값
    }
    if (!raw || typeof raw !== 'object') return { profiles: [], activeProfileId: null };

    let profiles: CompletionProfile[];
    let activeProfileId: string | null;
    if (Array.isArray(raw.profiles)) {
      profiles = raw.profiles.filter((p) => p && typeof p.id === 'string' && typeof p.model === 'string');
      activeProfileId = raw.activeProfileId ?? null;
    } else if (raw.completion && typeof raw.completion.provider === 'string' && raw.completion.provider !== 'none') {
      // 구버전 단일 설정 → 프로파일 1개 (apiKeyEnc는 복호화 불가 — 버림)
      const c = raw.completion;
      const p: CompletionProfile = {
        id: randomUUID(),
        name: c.model || c.provider,
        provider: c.provider as 'anthropic' | 'openai',
        model: c.model,
      };
      if (c.baseURL) p.baseURL = c.baseURL;
      if (c.apiKey) p.apiKey = c.apiKey;
      profiles = [p];
      activeProfileId = p.id;
    } else {
      profiles = [];
      activeProfileId = null;
    }
    if (activeProfileId !== null && !profiles.some((p) => p.id === activeProfileId)) {
      activeProfileId = profiles[0]?.id ?? null;
    }
    return { profiles, activeProfileId, appearance: raw.appearance, agent: raw.agent, context7ApiKey: raw.context7ApiKey };
  }

  private write(n: Normalized): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const file: SettingsFile = { profiles: n.profiles, activeProfileId: n.activeProfileId };
    if (n.appearance) file.appearance = n.appearance;
    if (n.agent) file.agent = n.agent;
    if (n.context7ApiKey) file.context7ApiKey = n.context7ApiKey;
    // 평문 키 포함 — 소유자 외 읽기 차단
    fs.writeFileSync(this.filePath(), JSON.stringify(file, null, 2), { mode: 0o600 });
    fs.chmodSync(this.filePath(), 0o600); // 기존 파일에 덮어쓸 때도 권한 보장
  }

  private active(): CompletionProfile | null {
    const n = this.read();
    return n.profiles.find((p) => p.id === n.activeProfileId) ?? null;
  }

  /** 활성 프로파일 뷰 — completion/chat 서비스가 그대로 소비 */
  getCompletion(): StoredCompletionSettings {
    const a = this.active();
    if (!a) return { provider: 'none', model: '' };
    return { provider: a.provider, model: a.model, baseURL: a.baseURL };
  }

  getApiKey(): string | null {
    return this.active()?.apiKey ?? null;
  }

  /** 전체 교체 저장. apiKey undefined = 같은 id의 기존 키 유지, '' = 삭제.
   *  activeIndex는 profiles 배열 인덱스 (null = 사용 안 함) — 새 프로파일은 저장 시 id가 생기므로 인덱스로 지정한다. */
  setProfiles(inputs: CompletionProfileInput[], activeIndex: number | null): void {
    const prev = this.read();
    const profiles = inputs.map((input) => {
      const existing = input.id ? prev.profiles.find((p) => p.id === input.id) : undefined;
      const p: CompletionProfile = {
        id: existing?.id ?? randomUUID(),
        name: input.name || input.model,
        provider: input.provider,
        model: input.model,
      };
      if (input.baseURL) p.baseURL = input.baseURL;
      const key = input.apiKey === undefined ? existing?.apiKey : input.apiKey === '' ? undefined : input.apiKey;
      if (key) p.apiKey = key;
      return p;
    });
    const activeProfileId =
      activeIndex !== null && activeIndex >= 0 && activeIndex < profiles.length ? profiles[activeIndex].id : null;
    this.write({ ...prev, profiles, activeProfileId });
  }

  /** 활성 프로파일 전환 (채팅 모델 드롭다운) — null = 사용 안 함 */
  setActiveProfile(id: string | null): void {
    const prev = this.read();
    const activeProfileId = id !== null && prev.profiles.some((p) => p.id === id) ? id : null;
    this.write({ ...prev, activeProfileId });
  }

  getAppearance(): { theme: string } {
    return this.read().appearance ?? { theme: 'dark-plus' };
  }

  setAppearance(a: { theme: string }): void {
    const prev = this.read();
    this.write({ ...prev, appearance: { theme: a.theme } });
  }

  getAgent(): { allowedDirs: string[] } {
    return this.read().agent ?? { allowedDirs: [] };
  }

  setAgent(a: { allowedDirs: string[] }): void {
    const prev = this.read();
    this.write({ ...prev, agent: { allowedDirs: a.allowedDirs.filter((d) => typeof d === 'string' && d) } });
  }

  getContext7Key(): string | null {
    return this.read().context7ApiKey ?? null;
  }

  /** '' = 삭제 */
  setContext7Key(key: string): void {
    const prev = this.read();
    this.write({ ...prev, context7ApiKey: key || undefined });
  }

  toPublic(): CompletionSettings {
    const n = this.read();
    const a = n.profiles.find((p) => p.id === n.activeProfileId) ?? null;
    return {
      provider: a?.provider ?? 'none',
      model: a?.model ?? '',
      baseURL: a?.baseURL,
      hasApiKey: !!a?.apiKey,
      profiles: n.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        provider: p.provider,
        model: p.model,
        baseURL: p.baseURL,
        hasApiKey: !!p.apiKey,
      })),
      activeId: n.activeProfileId,
      hasContext7Key: !!n.context7ApiKey,
    };
  }
}
