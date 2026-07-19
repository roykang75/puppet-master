import { useEffect, useRef, useState } from 'react';
import { VscLayout, VscCopy, VscCheck } from 'react-icons/vsc';
import { useAppStore } from '../store';
import { captureLayout, applyLayout } from '../layout-presets';
import type { LayoutPresets } from '../../../shared/protocol';

function LayoutPresetControl() {
  const [presets, setPresets] = useState<LayoutPresets>({});
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.si.layoutPresetsGet().then(setPresets);
  }, []);
  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  const persist = (next: LayoutPresets) => {
    setPresets(next);
    void window.si.layoutPresetsSave(next);
  };
  const save = (name: string) => {
    const n = name.trim();
    setNaming(false);
    if (!n) return;
    persist({ ...presets, [n]: captureLayout() });
  };
  const remove = (name: string) => {
    const next = { ...presets };
    delete next[name];
    persist(next);
  };
  const names = Object.keys(presets);

  return (
    <span className="layout-preset">
      <button className="layout-preset-btn" title="레이아웃 프리셋" onClick={() => { setOpen((o) => !o); setNaming(false); }}>
        <VscLayout />
      </button>
      {open && (
        <>
          <div className="open-editors-backdrop" onMouseDown={() => { setOpen(false); setNaming(false); }} />
          <div className="open-editors-menu layout-preset-menu">
            <div className="open-editors-title">레이아웃 프리셋</div>
            {names.length === 0 && !naming && <div className="hint">저장된 프리셋이 없습니다.</div>}
            {names.map((name) => (
              <div key={name} className="open-editors-item" onClick={() => { applyLayout(presets[name]); setOpen(false); }}>
                <span className="open-editors-name">{name}</span>
                <span className="tab-close" onClick={(e) => { e.stopPropagation(); remove(name); }}>×</span>
              </div>
            ))}
            {naming ? (
              <input
                ref={inputRef}
                className="chat-thread-search-input"
                placeholder="프리셋 이름"
                onKeyDown={(e) => { if (e.key === 'Enter') save((e.target as HTMLInputElement).value); if (e.key === 'Escape') setNaming(false); }}
                onBlur={(e) => save(e.target.value)}
              />
            ) : (
              <div className="open-editors-item layout-preset-save" onClick={() => setNaming(true)}>+ 현재 레이아웃 저장…</div>
            )}
          </div>
        </>
      )}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="statusbar-copy"
      title="복사"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
    >
      {copied ? <VscCheck /> : <VscCopy />}
    </button>
  );
}

export function StatusBar() {
  const indexing = useAppStore((s) => s.indexing);
  const stats = useAppStore((s) => s.stats);
  const error = useAppStore((s) => s.error);
  const completionStatus = useAppStore((s) => s.completionStatus);
  const lspStopped = useAppStore((s) => s.lspStopped);
  const activePath = useAppStore((s) => s.activePath);
  return (
    <div className="statusbar">
      <span className="statusbar-msg">
        {error ? <><span className="error">{error}</span><CopyButton text={error} /></>
          : indexing ? `인덱싱 ${indexing.done}/${indexing.total}`
          : stats ? `파일 ${stats.files + stats.skipped} · 심볼 ${stats.symbols}`
          : ''}
      </span>
      {completionStatus && <span className="statusbar-msg"><span className="error">{completionStatus}</span><CopyButton text={completionStatus} /></span>}
      {lspStopped.length > 0 && <span className="error">LSP({lspStopped.join(',')}): 중지됨</span>}
      <span className="statusbar-path">{activePath ?? ''}</span>
      <LayoutPresetControl />
    </div>
  );
}
