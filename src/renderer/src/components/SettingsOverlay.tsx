import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { refreshCompletionSettings } from '../completion-provider';
import { monaco } from '../monaco-setup';
import { applyThemeById } from '../theming/apply';
import { BUNDLED_THEMES } from '../theming/bundled';
import { refreshSnippets } from '../snippets';
import type { CompletionProfileInput, CompletionSettings } from '../../../shared/protocol';

type Provider = 'anthropic' | 'openai';

const MODEL_PLACEHOLDER: Record<Provider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: '로컬: Qwen2.5-Coder 계열 권장',
};

// 편집 중 프로파일 — apiKey는 입력 시에만 전송(빈 값 = 기존 키 유지)
interface EditProfile {
  id?: string;
  key: string; // React key (새 프로파일은 저장 전 id가 없다)
  name: string;
  provider: Provider;
  model: string;
  baseURL: string;
  apiKey: string;
  hasApiKey: boolean;
}

export function SettingsOverlay() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);

  const [profiles, setProfiles] = useState<EditProfile[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [theme, setTheme] = useState('dark-plus');
  const [themeOptions, setThemeOptions] = useState<{ id: string; name: string }[]>(BUNDLED_THEMES);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 오버레이 열릴 때마다 저장된 설정 로드 (API 키는 hasApiKey 불리언만)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setSaving(false);
    void window.si
      .getCompletionSettings()
      .then((s: CompletionSettings) => {
        if (cancelled) return;
        setProfiles(
          s.profiles.map((p) => ({
            id: p.id,
            key: p.id,
            name: p.name,
            provider: p.provider,
            model: p.model,
            baseURL: p.baseURL ?? '',
            apiKey: '',
            hasApiKey: p.hasApiKey,
          })),
        );
        const idx = s.profiles.findIndex((p) => p.id === s.activeId);
        setActiveIdx(idx >= 0 ? idx : null);
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
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);

  const update = (i: number, patch: Partial<EditProfile>) =>
    setProfiles((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const addProfile = () => {
    setProfiles((prev) => [
      ...prev,
      { key: crypto.randomUUID(), name: '', provider: 'openai', model: '', baseURL: '', apiKey: '', hasApiKey: false },
    ]);
    if (activeIdx === null) setActiveIdx(profiles.length); // 첫 추가면 바로 활성
  };

  const removeProfile = (i: number) => {
    setProfiles((prev) => prev.filter((_, j) => j !== i));
    setActiveIdx((a) => (a === null ? null : a === i ? null : a > i ? a - 1 : a));
  };

  const save = () => {
    if (saving) return;
    for (const p of profiles) {
      if (!p.model.trim()) {
        setError('모델이 비어 있는 프로파일이 있습니다.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    void (async () => {
      try {
        const inputs: CompletionProfileInput[] = profiles.map((p) => ({
          id: p.id,
          name: p.name.trim() || p.model.trim(),
          provider: p.provider,
          model: p.model.trim(),
          baseURL: p.provider === 'openai' && p.baseURL.trim() ? p.baseURL.trim() : undefined,
          apiKey: p.apiKey || undefined, // 빈 값 = 기존 키 유지
        }));
        await window.si.setCompletionSettings(inputs, activeIdx);
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
      <div className="search-box settings-box" onKeyDown={onKey} ref={boxRef}>
        <div className="settings-header">AI 설정</div>

        <div className="settings-body">
          <div className="settings-section-title">
            <span>모델 프로파일 — 활성 1개를 자동완성/채팅이 사용</span>
            <button className="rename-btn" onClick={addProfile}>＋ 모델 추가</button>
          </div>

          <label className="settings-field profile-none">
            <input
              type="radio"
              name="active-profile"
              checked={activeIdx === null}
              onChange={() => setActiveIdx(null)}
            />
            <span>사용 안 함</span>
          </label>

          {profiles.map((p, i) => (
            <div key={p.key} className="profile-card">
              <div className="profile-head">
                <label className="profile-active">
                  <input
                    type="radio"
                    name="active-profile"
                    checked={activeIdx === i}
                    onChange={() => setActiveIdx(i)}
                  />
                  <input
                    className="profile-name"
                    value={p.name}
                    placeholder="이름 (비우면 모델명)"
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </label>
                <button className="profile-remove" title="삭제" onClick={() => removeProfile(i)}>×</button>
              </div>
              <label className="settings-field">
                <span className="settings-label">제공자</span>
                <select value={p.provider} onChange={(e) => update(i, { provider: e.target.value as Provider })}>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI 호환 (로컬 등)</option>
                </select>
              </label>
              <label className="settings-field">
                <span className="settings-label">모델</span>
                <input
                  value={p.model}
                  placeholder={MODEL_PLACEHOLDER[p.provider]}
                  onChange={(e) => update(i, { model: e.target.value })}
                />
              </label>
              {p.provider === 'openai' && (
                <label className="settings-field">
                  <span className="settings-label">Base URL</span>
                  <input
                    value={p.baseURL}
                    placeholder="http://localhost:1234/v1"
                    onChange={(e) => update(i, { baseURL: e.target.value })}
                  />
                </label>
              )}
              <label className="settings-field">
                <span className="settings-label">API 키{p.hasApiKey ? ' (저장됨)' : ''}</span>
                <input
                  type="password"
                  value={p.apiKey}
                  placeholder="변경 시에만 입력 — 저장된 키는 표시되지 않음"
                  onChange={(e) => update(i, { apiKey: e.target.value })}
                />
              </label>
            </div>
          ))}

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
