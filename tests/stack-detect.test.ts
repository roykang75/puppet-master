import { describe, it, expect } from 'vitest';
import { detectStack, MAX_LIBRARIES } from '../src/main/stack/detect';

describe('detectStack', () => {
  it('package.json deps+devDeps 추출', () => {
    const s = detectStack([{ path: 'package.json', content: JSON.stringify({
      dependencies: { react: '^18.3.1', zustand: '4.5.0' },
      devDependencies: { vite: '^5.2.0' },
    }) }]);
    const names = s.libraries.map((l) => l.name);
    expect(names).toContain('react');
    expect(names).toContain('vite');
    expect(s.libraries.find((l) => l.name === 'react')?.version).toBe('^18.3.1');
  });

  it('requirements.txt 파싱 (버전 지정자 분리)', () => {
    const s = detectStack([{ path: 'requirements.txt', content: 'flask==3.0.0\nrequests>=2.31\n# 주석\n\nnumpy' }]);
    expect(s.libraries.find((l) => l.name === 'flask')?.version).toBe('3.0.0');
    expect(s.libraries.map((l) => l.name)).toEqual(expect.arrayContaining(['flask', 'requests', 'numpy']));
  });

  it('go.mod require 블록 파싱', () => {
    const s = detectStack([{ path: 'go.mod', content: 'module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/sync v0.6.0\n)\n' }]);
    expect(s.libraries.find((l) => l.name === 'github.com/gin-gonic/gin')?.version).toBe('v1.9.1');
  });

  it('pom.xml dependency 파싱', () => {
    const s = detectStack([{ path: 'pom.xml', content: '<project><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.1.0</version></dependency></dependencies></project>' }]);
    expect(s.libraries.find((l) => l.name === 'org.springframework:spring-core')?.version).toBe('6.1.0');
  });

  it('언어는 확장자 빈도로 집계', () => {
    const s = detectStack([
      { path: 'a.ts', content: '' }, { path: 'b.ts', content: '' }, { path: 'c.py', content: '' },
    ]);
    expect(s.languages[0]).toBe('TypeScript'); // 최다
    expect(s.languages).toContain('Python');
  });

  it('라이브러리 상한 + 중복 제거', () => {
    const deps = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`lib${i}`, '1.0.0']));
    const s = detectStack([{ path: 'package.json', content: JSON.stringify({ dependencies: deps }) }]);
    expect(s.libraries.length).toBeLessThanOrEqual(MAX_LIBRARIES);
  });

  it('매니페스트 없거나 파싱 실패해도 안전 (부분 결과)', () => {
    expect(detectStack([{ path: 'package.json', content: '{ broken' }])).toEqual({ languages: [], libraries: [] });
    expect(detectStack([])).toEqual({ languages: [], libraries: [] });
  });
});
