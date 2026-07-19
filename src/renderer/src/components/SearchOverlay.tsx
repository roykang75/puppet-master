import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import { getContent } from './EditorPane';
import { ensureLanguageRegistered } from '../textmate/registry';
import { buildPreviewSlice, type PreviewSlice } from '../search-preview';
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

/** 항목의 미리보기/점프용 1-기반 대상 줄. symbol.line은 이미 1-기반, text.line은 0-기반. */
const targetLineOf = (it: Item): number => (it.kind === 'symbol' ? it.line! : it.line! + 1);

/** 경로 확장자를 등록된 Monaco 언어에 매칭. 없으면 'plaintext'. colorize용 languageId. */
function monacoLanguageForPath(m: typeof monaco, p: string): string {
  const name = p.split('/').pop() ?? p;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!ext) return 'plaintext';
  for (const lang of m.languages.getLanguages()) {
    if (lang.extensions?.some((e) => e.toLowerCase() === ext)) return lang.id;
  }
  return 'plaintext';
}

interface Preview {
  path: string;
  targetLine: number; // 1-기반
  slice: PreviewSlice;
  html?: string[]; // colorize 성공 시 줄별 HTML(.mtkN 스팬, Monaco가 이스케이프). 없으면 평문 폴백.
}

export function SearchOverlay() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 마지막으로 읽은 (path, content) 한 쌍만 캐시 — 같은 파일 연속 선택 시 재읽기 방지
  const contentCache = useRef<{ path: string; content: string } | null>(null);

  useEffect(() => {
    if (open) {
      // 에디터 선택 시드가 있으면 프리필(즉시 클리어) — 없으면 빈칸으로 시작
      const seed = useAppStore.getState().searchSeed;
      if (seed) useAppStore.getState().setSearchSeed(null);
      setQ(seed ?? '');
      setItems([]);
      setSel(0);
      setTimeout(() => {
        inputRef.current?.focus();
        if (seed) inputRef.current?.select(); // 전체 선택 — 타이핑 시 교체
      }, 0);
    } else {
      // 닫힐 때 미리보기 상태 초기화
      setPreview(null);
      contentCache.current = null;
    }
  }, [open]);

  // 선택(sel) 변경 시 디바운스 후 미리보기 로드. 열린 탭이면 편집 중 버퍼 우선, 없으면 디스크 읽기.
  useEffect(() => {
    if (!open) return;
    const it = items[sel];
    if (!it) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const targetLine = targetLineOf(it);
    const t = setTimeout(() => {
      void (async () => {
        let content: string | null;
        if (contentCache.current?.path === it.path) {
          content = contentCache.current.content;
        } else {
          content = getContent(it.path) ?? (await window.si.readFile(it.path).catch(() => null));
          if (content != null) contentCache.current = { path: it.path, content };
        }
        if (cancelled) return;
        if (content == null) {
          setPreview(null);
          return;
        }
        const slice = buildPreviewSlice(content, targetLine);
        // 구문 강조: 언어 결정 → TextMate 토크나이저 지연 등록(실패해도 monarch/plaintext로 무해)
        //  → colorize. 예외/줄수 불일치 시 html 미설정 → 평문 폴백.
        let html: string[] | undefined;
        try {
          const languageId = monacoLanguageForPath(monaco, it.path);
          await ensureLanguageRegistered(monaco, languageId);
          if (cancelled) return;
          const colored = await monaco.editor.colorize(slice.lines.join('\n'), languageId, { tabSize: 4 });
          if (cancelled) return;
          const parts = colored.split(/<br\s*\/?>/); // colorize는 줄을 <br/>로 구분
          if (parts.length >= slice.lines.length) html = parts.slice(0, slice.lines.length);
        } catch {
          html = undefined; // colorize 실패 → 평문 렌더
        }
        if (cancelled) return;
        setPreview({ path: it.path, targetLine, slice, html });
      })();
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sel, items, open]);

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
              onClick={() => setSel(idxOf(it))}
              onDoubleClick={() => pick(it)}
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
                  onClick={() => setSel(idxOf(it))}
                  onDoubleClick={() => pick(it)}
                >
                  <span className="search-lineno">{it.line! + 1}</span>
                  <span className="search-label search-snippet">{highlight(it.lineText!, it.query!)}</span>
                </div>
              ))}
            </div>
          ))}
          {q.trim().length >= 2 && items.length === 0 && <div className="hint">결과 없음</div>}
        </div>
        {preview && (
          <div className="search-preview">
            <div className="search-preview-head">
              {preview.path}:{preview.targetLine}
            </div>
            <div className="search-preview-body">
              {preview.slice.lines.map((ln, i) => {
                const lineNo = preview.slice.startLine + i;
                const active = lineNo === preview.targetLine;
                const lineHtml = preview.html?.[i];
                return (
                  <div key={lineNo} className={`search-preview-line${active ? ' active' : ''}`}>
                    <span className="search-preview-lineno">{lineNo}</span>
                    {lineHtml != null ? (
                      // Monaco colorize가 이스케이프한 .mtkN 스팬 — 안전. 빈 줄은 nbsp로 높이 유지.
                      <span
                        className="search-preview-code"
                        dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                      />
                    ) : (
                      <span className="search-preview-code">{ln || ' '}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
