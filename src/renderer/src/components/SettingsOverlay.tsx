import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { refreshCompletionSettings } from '../completion-provider';
import { monaco } from '../monaco-setup';
import { applyThemeById } from '../theming/apply';
import { BUNDLED_THEMES } from '../theming/bundled';
import { refreshSnippets } from '../snippets';
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
  const [theme, setTheme] = useState('dark-plus');
  const [themeOptions, setThemeOptions] = useState<{ id: string; name: string }[]>(BUNDLED_THEMES);
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
    // 외관: 현재 테마 + 사용자 테마 목록 로드 (번들 + user 합산)
    void window.si.getAppearance().then((a) => {
      if (!cancelled) setTheme(a.theme);
    });
    void window.si.themeList().then((list) => {
      if (!cancelled) setThemeOptions([...BUNDLED_THEMES, ...list]);
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
    void (async () => {
      try {
        await window.si.setCompletionSettings(
          { provider, model, baseURL: provider === 'openai' && baseURL ? baseURL : undefined },
          apiKey || undefined,
        );
        void refreshCompletionSettings(); // 설정 캐시 갱신 + auth 비활성 해제
        await window.si.setAppearance({ theme });
        await applyThemeById(monaco, theme); // 즉시 적용
        refreshSnippets(); // 스니펫 재로드 (다음 완성 요청 때 재로드, 스펙 §4)
        close();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      }
    })();
  };

  // 테마 가져오기 — 성공 시 목록 갱신 + 해당 테마 선택, {error}면 오류 표시
  const importTheme = () => {
    void window.si.themeImport().then((r) => {
      if (!r) return; // 취소
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setError(null);
      setThemeOptions((prev) => (prev.some((o) => o.id === r.id) ? prev : [...prev, r]));
      setTheme(r.id);
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

          <label className="settings-field">
            <span className="settings-label">테마</span>
            <select id="theme-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
              {themeOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>

          <div className="settings-field">
            <span className="settings-label">테마 / 스니펫</span>
            <div className="settings-actions" style={{ padding: 0, border: 'none', justifyContent: 'flex-start' }}>
              <button className="rename-btn" onClick={importTheme}>테마 가져오기…</button>
              <button className="rename-btn" onClick={() => void window.si.snippetsOpenFolder()}>스니펫 폴더 열기</button>
            </div>
          </div>

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
