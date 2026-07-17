import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { refreshCompletionSettings } from '../completion-provider';
import type { CompletionSettings } from '../../../shared/protocol';

type Provider = 'none' | 'anthropic' | 'openai';

const MODEL_PLACEHOLDER: Record<Provider, string> = {
  none: '',
  anthropic: 'claude-haiku-4-5',
  openai: '로컬: Qwen2.5-Coder 계열 권장',
};

export function SettingsOverlay() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);

  const [provider, setProvider] = useState<Provider>('none');
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLSelectElement>(null);

  // 오버레이 열릴 때마다 저장된 설정 로드 (API 키는 hasApiKey 불리언만)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setApiKey('');
    setError(null);
    setSaving(false);
    void window.si
      .getCompletionSettings()
      .then((s: CompletionSettings) => {
        if (cancelled) return;
        setProvider(s.provider);
        setModel(s.model);
        setBaseURL(s.baseURL ?? '');
        setHasApiKey(s.hasApiKey);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    setTimeout(() => firstRef.current?.focus(), 0);
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);

  const save = () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    void window.si
      .setCompletionSettings(
        { provider, model, baseURL: provider === 'openai' && baseURL ? baseURL : undefined },
        apiKey || undefined,
      )
      .then(() => {
        void refreshCompletionSettings(); // 설정 캐시 갱신 + auth 비활성 해제
        close();
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  return (
    // click 대신 mousedown + target 검사 — 입력란에서 드래그해 밖에서 떼면 click target이
    // 공통 조상(backdrop)으로 판정돼 창이 닫히는 문제 방지
    <div className="search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="search-box settings-box" onKeyDown={onKey}>
        <div className="settings-header">AI 코드 자동완성 설정</div>

        <div className="settings-body">
          <label className="settings-field">
            <span className="settings-label">제공자</span>
            <select
              ref={firstRef}
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              <option value="none">사용 안 함</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI 호환 (로컬 등)</option>
            </select>
          </label>

          {provider !== 'none' && (
            <>
              <label className="settings-field">
                <span className="settings-label">모델</span>
                <input
                  value={model}
                  placeholder={MODEL_PLACEHOLDER[provider]}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>

              {provider === 'openai' && (
                <label className="settings-field">
                  <span className="settings-label">Base URL</span>
                  <input
                    value={baseURL}
                    placeholder="http://localhost:1234/v1"
                    onChange={(e) => setBaseURL(e.target.value)}
                  />
                </label>
              )}

              <label className="settings-field">
                <span className="settings-label">API 키{hasApiKey ? ' (저장됨)' : ''}</span>
                <input
                  type="password"
                  value={apiKey}
                  placeholder="변경 시에만 입력 — 저장된 키는 표시되지 않음"
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
            </>
          )}

          {error && <div className="settings-error">오류: {error}</div>}
        </div>

        <div className="settings-actions">
          <button className="rename-btn" onClick={close}>취소</button>
          <button className="rename-btn primary" onClick={save} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
