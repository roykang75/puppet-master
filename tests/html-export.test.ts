import { describe, it, expect } from 'vitest';
import { buildHtmlDocument } from '../src/renderer/src/html-doc';

describe('buildHtmlDocument', () => {
  it('제목/본문/토큰CSS/색을 포함한 자기완결 문서', () => {
    const doc = buildHtmlDocument({
      title: 'foo.ts',
      bodyHtml: '<span class="mtk1">const</span>',
      tokenCss: '.mtk1 { color: #569cd6; }',
      bg: '#1e1e1e',
      fg: '#d4d4d4',
    });
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('<title>foo.ts</title>');
    expect(doc).toContain('<span class="mtk1">const</span>');
    expect(doc).toContain('.mtk1 { color: #569cd6; }');
    expect(doc).toContain('background: #1e1e1e');
    expect(doc).toContain('color: #d4d4d4');
    expect(doc).toContain('white-space: pre'); // .code 컨테이너
  });

  it('제목의 HTML 특수문자 이스케이프', () => {
    const doc = buildHtmlDocument({ title: '<x>&y', bodyHtml: '', tokenCss: '', bg: '', fg: '' });
    expect(doc).toContain('<title>&lt;x&gt;&amp;y</title>');
  });

  it('bg/fg 비면 기본색 폴백', () => {
    const doc = buildHtmlDocument({ title: 't', bodyHtml: '', tokenCss: '', bg: '', fg: '' });
    expect(doc).toContain('background: #1e1e1e');
    expect(doc).toContain('color: #d4d4d4');
  });
});
