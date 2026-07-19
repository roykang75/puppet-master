import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import type { SymbolHit, TextMatch } from '../../../indexer/api';

interface Item {
  kind: 'symbol' | 'text';
  label: string;
  detail: string;
  path: string;
  line?: number; // symbol: 1-based / text: 0-based(원본)
  col?: number; // text: 0-based(원본)
  lineText?: string; // text만
  query?: string; // text 하이라이트용
}

const TEXT_LIMIT = 200; // searchTextDetailed의 전체 캡과 동일

/** 질의를 대소문자 무시 부분일치로 강조. lineText 표시용. */
function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let idx: number;
  let key = 0;
  while ((idx = lower.indexOf(q, from)) !== -1) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <span key={key++} className="search-hl">
        {text.slice(idx, idx + q.length)}
      </span>,
    );
    from = idx + q.length;
  }
  parts.push(text.slice(from));
  return parts;
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
        window.si.searchTextDetailed(q).catch(() => [] as TextMatch[]),
      ]).then(([syms, texts]) => {
        if (cancelled) return;
        const si: Item[] = syms.slice(0, 30).map((s) => ({
          kind: 'symbol',
          label: s.name,
          detail: `${s.kind} · ${s.path}:${s.line + 1}`,
          path: s.path,
          line: s.line + 1,
        }));
        const ti: Item[] = texts.map((m) => ({
          kind: 'text',
          label: m.lineText,
          detail: m.path,
          path: m.path,
          line: m.line,
          col: m.col,
          lineText: m.lineText,
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
    else jumpTo(it.path, it.line! + 1, it.col! + 1); // text: 0-기반 → 1-기반
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

  // 텍스트 결과를 path별 그룹으로 (첫 등장 순서 유지)
  const textGroups: { path: string; group: Item[] }[] = [];
  for (const it of texts) {
    let g = textGroups.find((x) => x.path === it.path);
    if (!g) {
      g = { path: it.path, group: [] };
      textGroups.push(g);
    }
    g.group.push(it);
  }

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
          {texts.length > 0 && (
            <div className="search-section">
              텍스트
              {texts.length >= TEXT_LIMIT && <span className="search-cap"> — 일치 {TEXT_LIMIT}+개, 상위만 표시</span>}
            </div>
          )}
          {textGroups.map((tg) => (
            <div key={`g${tg.path}`}>
              <div className="search-file-header">
                <span className="search-file-path">{tg.path}</span>
                <span className="search-file-count">{tg.group.length}</span>
              </div>
              {tg.group.map((it) => (
                <div
                  key={`t${idxOf(it)}`}
                  className={`search-item search-line-item${idxOf(it) === sel ? ' selected' : ''}`}
                  onClick={() => pick(it)}
                >
                  <span className="search-lineno">{it.line! + 1}</span>
                  <span className="search-label search-snippet">{highlight(it.lineText!, it.query!)}</span>
                </div>
              ))}
            </div>
          ))}
          {q.trim().length >= 2 && items.length === 0 && <div className="hint">결과 없음</div>}
        </div>
      </div>
    </div>
  );
}
