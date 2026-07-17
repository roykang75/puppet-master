import type { JSX } from 'react';
import { parseMarkdown, type InlineSpan } from '../chat-markdown';

/** chat-markdown 블록을 React 엘리먼트로 렌더 — 채팅 응답과 마크다운 미리보기가 공유 */
function renderSpans(spans: InlineSpan[]): JSX.Element[] {
  return spans.map((s, i) =>
    s.kind === 'code' ? (
      <code key={i} className="chat-inline-code">{s.text}</code>
    ) : s.kind === 'bold' ? (
      <strong key={i}>{s.text}</strong>
    ) : s.kind === 'italic' ? (
      <em key={i}>{s.text}</em>
    ) : (
      <span key={i}>{s.text}</span>
    ),
  );
}

export function renderMarkdown(content: string): JSX.Element[] {
  return parseMarkdown(content).map((b, i) => {
    switch (b.kind) {
      case 'heading':
        return <div key={i} className={`chat-h chat-h${b.level}`}>{renderSpans(b.spans)}</div>;
      case 'code':
        return <pre key={i} className="chat-code">{b.text}</pre>;
      case 'hr':
        return <div key={i} className="chat-hr" />;
      case 'table':
        return (
          <div key={i} className="chat-table-wrap">
            <table className="chat-table">
              <thead>
                <tr>
                  {b.header.map((cell, j) => (
                    <th key={j} style={{ textAlign: b.aligns[j] ?? 'left' }}>{renderSpans(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ textAlign: b.aligns[j] ?? 'left' }}>{renderSpans(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'list': {
        const items = b.items.map((it, j) => (
          <li key={j} style={it.depth ? { marginLeft: it.depth * 16 } : undefined}>{renderSpans(it.spans)}</li>
        ));
        return b.ordered ? <ol key={i} className="chat-list">{items}</ol> : <ul key={i} className="chat-list">{items}</ul>;
      }
      default:
        return <p key={i} className="chat-p">{renderSpans(b.spans)}</p>;
    }
  });
}

export function MarkdownView({ content }: { content: string }) {
  return <div className="md-view">{renderMarkdown(content)}</div>;
}
