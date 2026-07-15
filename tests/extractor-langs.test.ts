import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { languageForPath } from '../src/indexer/languages';

describe('C++', () => {
  const src = `
namespace app {
class Widget {
 public:
  int area();
};
int Widget::area() { return compute(); }
}
`;
  const r = extractFile(src, languageForPath('a.cpp')!);
  it('extracts namespace, class, method', () => {
    expect(r.symbols.find((s) => s.name === 'app')?.kind).toBe('namespace');
    expect(r.symbols.find((s) => s.name === 'Widget')?.kind).toBe('class');
    expect(r.symbols.some((s) => s.name === 'area' && (s.kind === 'method' || s.kind === 'function'))).toBe(true);
  });
  it('captures call ref', () => {
    expect(r.refs.some((x) => x.name === 'compute')).toBe(true);
  });
});

describe('Python', () => {
  const src = `
MAX = 10

class Service:
    def handle(self, req):
        return validate(req)

def main():
    s = Service()
    s.handle(1)
`;
  const r = extractFile(src, languageForPath('a.py')!);
  it('extracts class, function, module variable', () => {
    expect(r.symbols.find((s) => s.name === 'Service')?.kind).toBe('class');
    expect(r.symbols.find((s) => s.name === 'handle')?.kind).toBe('function');
    expect(r.symbols.find((s) => s.name === 'main')?.kind).toBe('function');
    expect(r.symbols.find((s) => s.name === 'MAX')?.kind).toBe('variable');
  });
  it('scope of handle is Service', () => {
    expect(r.symbols.find((s) => s.name === 'handle')?.scope).toBe('Service');
  });
  it('captures method call ref', () => {
    expect(r.refs.some((x) => x.name === 'handle')).toBe(true);
    expect(r.refs.some((x) => x.name === 'validate')).toBe(true);
  });
});

describe('Java', () => {
  const src = `
public class OrderService {
    private int count;
    public OrderService() {}
    public void process(Order o) {
        repository.save(o);
    }
}
`;
  const r = extractFile(src, languageForPath('A.java')!);
  it('extracts class, method, field, constructor', () => {
    expect(r.symbols.find((s) => s.name === 'OrderService' && s.kind === 'class')).toBeDefined();
    expect(r.symbols.find((s) => s.name === 'process')?.kind).toBe('method');
    expect(r.symbols.find((s) => s.name === 'count')?.kind).toBe('field');
  });
  it('captures call ref with enclosing method', () => {
    const call = r.refs.find((x) => x.name === 'save');
    expect(call).toBeDefined();
    expect(r.symbols[call!.enclosingIndex!].name).toBe('process');
  });
});
