import * as fs from 'fs';
import * as path from 'path';
import type { CompletionSettings } from '../shared/protocol';

export interface StoredCompletionSettings {
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  apiKey?: string; // 평문 저장 (사용자 결정 — dev 환경에서 safeStorage 키체인 접근이 프로세스마다 달라 복호화가 깨지는 문제로 전환)
  apiKeyEnc?: string; // 구버전(safeStorage 암호화) 잔재 — 더 이상 읽지 않음
}

interface SettingsFile {
  completion: StoredCompletionSettings;
  appearance?: { theme: string };
}

const DEFAULT_COMPLETION: StoredCompletionSettings = { provider: 'none', model: '' };

export class SettingsStore {
  constructor(private baseDir: string) {}

  private filePath(): string {
    return path.join(this.baseDir, 'settings.json');
  }

  private read(): SettingsFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath(), 'utf8')) as SettingsFile;
      if (raw && raw.completion && typeof raw.completion.provider === 'string') return raw;
    } catch {
      // 파일 없음/손상 → 기본값
    }
    return { completion: { ...DEFAULT_COMPLETION } };
  }

  private write(file: SettingsFile): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    // 평문 키 포함 — 소유자 외 읽기 차단
    fs.writeFileSync(this.filePath(), JSON.stringify(file, null, 2), { mode: 0o600 });
    fs.chmodSync(this.filePath(), 0o600); // 기존 파일에 덮어쓸 때도 권한 보장
  }

  getCompletion(): StoredCompletionSettings {
    return this.read().completion;
  }

  // apiKey가 주어졌을 때만 갱신(빈 문자열은 키 삭제, undefined는 기존 키 유지).
  setCompletion(
    s: { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string },
    apiKey?: string,
  ): void {
    const file = this.read();
    const next: StoredCompletionSettings = {
      provider: s.provider,
      model: s.model,
      apiKey: file.completion.apiKey,
    };
    if (s.baseURL) next.baseURL = s.baseURL;

    if (apiKey !== undefined) {
      if (apiKey === '') {
        delete next.apiKey; // 빈 문자열 = 삭제
      } else {
        next.apiKey = apiKey;
      }
    }
    if (next.apiKey === undefined) delete next.apiKey;
    this.write({ ...file, completion: next });
  }

  getAppearance(): { theme: string } {
    return this.read().appearance ?? { theme: 'dark-plus' };
  }

  setAppearance(a: { theme: string }): void {
    const file = this.read();
    this.write({ ...file, appearance: { theme: a.theme } });
  }

  getApiKey(): string | null {
    return this.read().completion.apiKey ?? null;
  }

  toPublic(): CompletionSettings {
    const c = this.read().completion;
    return {
      provider: c.provider,
      model: c.model,
      baseURL: c.baseURL,
      hasApiKey: this.getApiKey() !== null,
    };
  }
}
