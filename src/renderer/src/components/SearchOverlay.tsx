import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import { findFirstAndReveal } from './EditorPane';
import type { SymbolHit, TextHit } from '../../../indexer/api';

interface Item {
  kind: 'symbol' | 'text';
  label: string;
  detail: string;
  path: string;
  line?: number; // symbol만
  query?: string; // text만
}

export function SearchOverlay() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setItems([]);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void Promise.all([
        window.si.searchSymbols(q).catch(() => [] as SymbolHit[]),
        window.si.searchText(q).catch(() => [] as TextHit[]),
      ]).then(([syms, texts]) => {
        if (cancelled) return;
        const si: Item[] = syms.slice(0, 30).map((s) => ({
          kind: 'symbol',
          label: s.name,
          detail: `${s.kind} · ${s.path}:${s.line + 1}`,
          path: s.path,
          line: s.line + 1,
        }));
        const ti: Item[] = texts.slice(0, 30).map((t2) => ({
          kind: 'text',
          label: t2.snippet,
          detail: t2.path,
          path: t2.path,
          query: q,
        }));
        setItems([...si, ...ti]);
        setSel(0);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  if (!open) return null;

  const pick = (it: Item) => {
    setOpen(false);
    if (it.kind === 'symbol') jumpTo(it.path, it.line!);
    else findFirstAndReveal(it.path, it.query!);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    }
    if (e.key === 'Enter' && items[sel]) pick(items[sel]);
  };

  const symbols = items.filter((i) => i.kind === 'symbol');
  const texts = items.filter((i) => i.kind === 'text');
  const idxOf = (it: Item) => items.indexOf(it);

  return (
    // click 대신 mousedown + target 검사 — 상자 안에서 드래그해 밖에서 떼도 닫히지 않도록
    <div className="search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="search-box">
        <input
          ref={inputRef}
          value={q}
          placeholder="심볼 조각 또는 텍스트 검색…  (Esc 닫기)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="search-results">
          {symbols.length > 0 && <div className="search-section">심볼</div>}
          {symbols.map((it) => (
            <div
              key={`s${idxOf(it)}`}
              className={`search-item${idxOf(it) === sel ? ' selected' : ''}`}
              onClick={() => pick(it)}
            >
              <span className="search-label">{it.label}</span>
              <span className="search-detail">{it.detail}</span>
            </div>
          ))}
          {texts.length > 0 && <div className="search-section">전문 (FTS)</div>}
          {texts.map((it) => (
            <div
              key={`t${idxOf(it)}`}
              className={`search-item${idxOf(it) === sel ? ' selected' : ''}`}
              onClick={() => pick(it)}
            >
              <span className="search-label search-snippet">{it.label}</span>
              <span className="search-detail">{it.detail}</span>
            </div>
          ))}
          {q.trim().length >= 2 && items.length === 0 && <div className="hint">결과 없음</div>}
        </div>
      </div>
    </div>
  );
}
