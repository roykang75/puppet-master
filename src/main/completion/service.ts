// AI 코드 자동완성 오케스트레이션 — electron 임포트 금지 (deps 주입으로 테스트 가능).
// 컨텍스트(아웃라인 시그니처) 구성 + 어댑터 캐시 + 오류 분류를 담당한다.
import type { CompletionContext, CompletionResult } from '../../shared/protocol';
import type { StoredCompletionSettings } from '../settings';
import type { BuiltContext } from './prompt';
import { AnthropicAdapter, type ProviderAdapter } from './anthropic-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { classifyError } from './errors';

const MAX_SIGNATURES = 20;
const MAX_OUTLINE_PATHS = 256; // 아웃라인 캐시 상한 — 초과 시 가장 오래된 항목 제거

export type AdapterFactory = (
  provider: 'anthropic' | 'openai',
  cfg: { model: string; apiKey: string | null; baseURL?: string },
) => ProviderAdapter;

const defaultAdapterFactory: AdapterFactory = (provider, cfg) => {
  if (provider === 'anthropic') {
    return new AnthropicAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? '' });
  }
  return new OpenAIAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? undefined, baseURL: cfg.baseURL });
};

export interface CompletionDeps {
  getSettings(): StoredCompletionSettings;
  getApiKey(): string | null;
  getOutline(path: string): Promise<Array<{ signature: string }>>; // 인덱서 rpc 래퍼 — 실패 시 throw 허용
  adapterFactory?: AdapterFactory;
}

export class CompletionService {
  private readonly adapterFactory: AdapterFactory;
  private outlineCache = new Map<string, string[]>();
  private cachedAdapter: ProviderAdapter | null = null;
  private cachedKey: string | null = null;

  constructor(private deps: CompletionDeps) {
    this.adapterFactory = deps.adapterFactory ?? defaultAdapterFactory;
  }

  // main의 sendIndexerEvent에서 fileIndexed(path) 릴레이 시 호출
  invalidateOutline(path: string): void {
    this.outlineCache.delete(path);
  }

  // 프로젝트 전환 시 — rel path가 새 프로젝트와 충돌하므로 전체 클리어
  clearOutlineCache(): void {
    this.outlineCache.clear();
  }

  // settings:completion:set 후 호출 — 어댑터/설정 캐시 리셋
  invalidateAdapter(): void {
    this.cachedAdapter = null;
    this.cachedKey = null;
  }

  async request(ctx: CompletionContext): Promise<CompletionResult> {
    const settings = this.deps.getSettings();
    if (settings.provider === 'none') return { text: null };

    const apiKey = this.deps.getApiKey();
    // anthropic만 키 필수 — openai는 로컬 LLM용으로 키 없이도 유효
    if (settings.provider === 'anthropic' && !apiKey) return { text: null };

    const symbolSignatures = await this.getSignatures(ctx.path);
    const built: BuiltContext = { ...ctx, symbolSignatures };

    const adapter = this.getAdapter(settings, apiKey);
    try {
      const text = await adapter.complete(built);
      return { text };
    } catch (e) {
      const kind = classifyError(e);
      // main 콘솔에만 상세 기록 (IPC 밖 — 키 에코 방어와 무관). 진단용.
      const err = e as { status?: number; message?: string };
      console.error(`[completion] provider error kind=${kind} status=${err?.status ?? '-'}: ${err?.message ?? e}`);
      // provider 원문 메시지는 IPC 경계를 넘기지 않음 (키 자료 에코 방어) — kind 기반 고정 문자열만 전달.
      return { text: null, error: { kind, message: kind } };
    }
  }

  private async getSignatures(path: string): Promise<string[]> {
    const cached = this.outlineCache.get(path);
    if (cached) return cached;

    let signatures: string[];
    try {
      const outline = await this.deps.getOutline(path);
      signatures = outline.map((s) => s.signature).filter(Boolean).slice(0, MAX_SIGNATURES);
    } catch {
      signatures = []; // getOutline 실패(인덱서 없음 등) → 시그니처 없이 진행
    }

    if (this.outlineCache.size >= MAX_OUTLINE_PATHS) {
      const oldest = this.outlineCache.keys().next().value;
      if (oldest !== undefined) this.outlineCache.delete(oldest);
    }
    this.outlineCache.set(path, signatures);
    return signatures;
  }

  private getAdapter(settings: StoredCompletionSettings, apiKey: string | null): ProviderAdapter {
    // 설정 스냅샷(키 포함) 기준 캐시 — apiKey 변경도 키에 반영된다
    const key = `${settings.provider}\0${settings.model}\0${settings.baseURL ?? ''}\0${apiKey ?? ''}`;
    if (this.cachedAdapter && this.cachedKey === key) return this.cachedAdapter;
    const adapter = this.adapterFactory(settings.provider as 'anthropic' | 'openai', {
      model: settings.model,
      apiKey,
      baseURL: settings.baseURL,
    });
    this.cachedAdapter = adapter;
    this.cachedKey = key;
    return adapter;
  }
}
