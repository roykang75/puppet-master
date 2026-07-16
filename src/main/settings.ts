import * as fs from 'fs';
import * as path from 'path';
import type { CompletionSettings } from '../shared/protocol';

// safeStorage 주입 인터페이스 — vitest에는 electron이 없으므로 SettingsStore는 이 추상화에만 의존한다.
export interface SettingsCrypto {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(enc: Buffer): string;
}

export interface StoredCompletionSettings {
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  apiKeyEnc?: string; // base64(safeStorage.encryptString)
}

interface SettingsFile {
  completion: StoredCompletionSettings;
}

const DEFAULT_COMPLETION: StoredCompletionSettings = { provider: 'none', model: '' };

export class SettingsStore {
  constructor(
    private baseDir: string,
    private crypto: SettingsCrypto,
  ) {}

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
    fs.writeFileSync(this.filePath(), JSON.stringify(file, null, 2));
  }

  getCompletion(): StoredCompletionSettings {
    return this.read().completion;
  }

  // apiKey가 주어졌을 때만 암호화 갱신(빈 문자열은 키 삭제, undefined는 기존 키 유지).
  // crypto.isAvailable()이 false인데 비어있지 않은 apiKey 저장을 시도하면 throw.
  setCompletion(
    s: { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string },
    apiKey?: string,
  ): void {
    const file = this.read();
    const next: StoredCompletionSettings = {
      provider: s.provider,
      model: s.model,
      apiKeyEnc: file.completion.apiKeyEnc,
    };
    if (s.baseURL) next.baseURL = s.baseURL;

    if (apiKey !== undefined) {
      if (apiKey === '') {
        delete next.apiKeyEnc; // 빈 문자열 = 삭제
      } else {
        if (!this.crypto.isAvailable()) throw new Error('이 시스템에서는 안전한 키 저장(safeStorage)을 사용할 수 없습니다.');
        next.apiKeyEnc = this.crypto.encrypt(apiKey).toString('base64');
      }
    }
    this.write({ completion: next });
  }

  getApiKey(): string | null {
    const enc = this.read().completion.apiKeyEnc;
    if (!enc) return null;
    try {
      return this.crypto.decrypt(Buffer.from(enc, 'base64'));
    } catch {
      return null; // decrypt 실패 → 조용히 강등 (throw 아님)
    }
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
