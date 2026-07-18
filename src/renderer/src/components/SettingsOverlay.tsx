import { useEffect, useRef, useState } from 'react';
import { VscAdd, VscTrash, VscEdit } from 'react-icons/vsc';
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
  const [allowedDirs, setAllowedDirs] = useState<string[]>([]);
  const [context7Key, setContext7Key] = useState('');
  const [hasContext7Key, setHasContext7Key] = useState(false);
  // 모델 추가/편집 팝업 — index null이면 신규, 아니면 해당 프로파일 편집
  const [editing, setEditing] = useState<{ index: number | null; draft: EditProfile } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
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
        setHasContext7Key(s.hasContext7Key);
        setContext7Key('');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    // 외관: 현재 테마 + 사용자 테마 목록 로드 (번들 + user 합산)
    void window.si.getAppearance().then((a) => {
      if (!cancelled) setTheme(a.theme);
    });
    void window.si.getAgentSettings().then((a) => {
      if (!cancelled) setAllowedDirs(a.allowedDirs);
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

  // 팝업 열기 — 신규/편집 모두 드래프트로 편집하고, 확인 시에만 profiles에 반영
  const openAdd = () => {
    setModalError(null);
    setEditing({ index: null, draft: { key: crypto.randomUUID(), name: '', provider: 'openai', model: '', baseURL: '', apiKey: '', hasApiKey: false } });
  };
  const openEdit = (i: number) => {
    setModalError(null);
    setEditing({ index: i, draft: { ...profiles[i], apiKey: '' } }); // 키는 항상 빈 값으로 시작(저장된 키 미표시)
  };
  const updateDraft = (patch: Partial<EditProfile>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const confirmEdit = () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.model.trim()) {
      setModalError('모델을 입력하세요.');
      return;
    }
    if (editing.index === null) {
      setProfiles((prev) => [...prev, d]);
      if (activeIdx === null) setActiveIdx(profiles.length); // 첫 추가면 바로 활성
    } else {
      const idx = editing.index;
      setProfiles((prev) => prev.map((p, j) => (j === idx ? d : p)));
    }
    setEditing(null);
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
        if (context7Key) await window.si.setContext7Key(context7Key); // 빈 값 = 기존 키 유지
        await window.si.setAppearance({ theme });
        await window.si.setAgentSettings({ allowedDirs });
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
    <>
    {/* click 대신 mousedown + target 검사 — 입력란에서 드래그해 밖에서 떼면 click target이
        공통 조상(backdrop)으로 판정돼 창이 닫히는 문제 방지 */}
    <div className="search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="search-box settings-box" onKeyDown={onKey} ref={boxRef}>
        <div className="settings-header">AI 설정</div>

        <div className="settings-body">
          <div className="settings-section-title">
            <span>모델 프로파일 — 활성 1개를 자동완성/채팅이 사용</span>
            <button className="rename-btn icon-btn" onClick={openAdd}><VscAdd /> 모델 추가</button>
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

          {profiles.length === 0 && <div className="hint">등록된 모델이 없습니다. "모델 추가"로 등록하세요.</div>}
          {profiles.map((p, i) => (
            <div key={p.key} className="profile-row">
              <input
                type="radio"
                name="active-profile"
                checked={activeIdx === i}
                onChange={() => setActiveIdx(i)}
              />
              <span className="profile-row-name" title={p.name.trim() || p.model.trim()}>
                {p.name.trim() || p.model.trim() || '(이름 없음)'}
              </span>
              <span className="profile-row-meta">
                {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · {p.model.trim() || '모델 미설정'}
                {p.hasApiKey || p.apiKey ? ' · 키✓' : ''}
              </span>
              <button className="profile-edit" title="편집" onClick={() => openEdit(i)}><VscEdit /></button>
              <button className="profile-remove" title="삭제" onClick={() => removeProfile(i)}><VscTrash /></button>
            </div>
          ))}

          <label className="settings-field">
            <span className="settings-label">Context7 API 키{hasContext7Key ? ' (저장됨)' : ''} (선택 — 문서 조회 rate limit 완화용)</span>
            <input
              type="password"
              value={context7Key}
              placeholder="변경 시에만 입력 — 저장된 키는 표시되지 않음"
              onChange={(e) => setContext7Key(e.target.value)}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label">테마</span>
            <select id="theme-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
              {themeOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>

          <div className="settings-field">
            <span className="settings-label">에이전트 추가 허용 디렉터리 (파일 도구가 접근 가능한 프로젝트 밖 경로)</span>
            {allowedDirs.map((d, i) => (
              <div key={i} className="allowed-dir-row">
                <span className="allowed-dir-path" title={d}>{d}</span>
                <button className="profile-remove" title="삭제" onClick={() => setAllowedDirs((prev) => prev.filter((_, j) => j !== i))}><VscTrash /></button>
              </div>
            ))}
            <div>
              <button
                className="rename-btn icon-btn"
                onClick={() => {
                  void window.si.openFolderDialog().then((dir) => {
                    if (dir) setAllowedDirs((prev) => (prev.includes(dir) ? prev : [...prev, dir]));
                  });
                }}
              ><VscAdd /> 폴더 추가…</button>
            </div>
          </div>

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

    {editing && (
      <div
        className="search-backdrop profile-modal-backdrop"
        onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
      >
        <div
          className="search-box settings-box profile-modal"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}
        >
          <div className="settings-header">{editing.index === null ? '모델 추가' : '모델 편집'}</div>
          <div className="settings-body">
            <label className="settings-field">
              <span className="settings-label">이름 (비우면 모델명)</span>
              <input
                autoFocus
                value={editing.draft.name}
                placeholder="예: 로컬 Qwen"
                onChange={(e) => updateDraft({ name: e.target.value })}
              />
            </label>
            <label className="settings-field">
              <span className="settings-label">제공자</span>
              <select value={editing.draft.provider} onChange={(e) => updateDraft({ provider: e.target.value as Provider })}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI 호환 (로컬 등)</option>
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-label">모델</span>
              <input
                value={editing.draft.model}
                placeholder={MODEL_PLACEHOLDER[editing.draft.provider]}
                onChange={(e) => updateDraft({ model: e.target.value })}
              />
            </label>
            {editing.draft.provider === 'openai' && (
              <label className="settings-field">
                <span className="settings-label">Base URL</span>
                <input
                  value={editing.draft.baseURL}
                  placeholder="http://localhost:1234/v1"
                  onChange={(e) => updateDraft({ baseURL: e.target.value })}
                />
              </label>
            )}
            <label className="settings-field">
              <span className="settings-label">API 키{editing.draft.hasApiKey ? ' (저장됨)' : ''}</span>
              <input
                type="password"
                value={editing.draft.apiKey}
                placeholder="변경 시에만 입력 — 저장된 키는 표시되지 않음"
                onChange={(e) => updateDraft({ apiKey: e.target.value })}
              />
            </label>
            {modalError && <div className="settings-error">오류: {modalError}</div>}
          </div>
          <div className="settings-actions">
            <button className="rename-btn" onClick={() => setEditing(null)}>취소</button>
            <button className="rename-btn primary" onClick={confirmEdit}>확인</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
