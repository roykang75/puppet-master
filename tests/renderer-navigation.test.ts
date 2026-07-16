import { describe, it, expect } from 'vitest';
import { NavHistory } from '../src/renderer/src/navigation';

const L = (line: number) => ({ path: 'a.ts', line, col: 1 });

describe('NavHistory', () => {
  it('push 후 back은 직전 위치, forward는 복귀', () => {
    const h = new NavHistory();
    h.push(L(1)); // 점프 직전 위치 기록
    const back = h.back(L(50)); // 현재 50에서 뒤로
    expect(back).toEqual(L(1));
    expect(h.forward(L(1))).toEqual(L(50));
  });
  it('빈 스택 back/forward는 null', () => {
    const h = new NavHistory();
    expect(h.back(L(1))).toBeNull();
    expect(h.forward(L(1))).toBeNull();
  });
  it('push는 forward 스택을 비운다', () => {
    const h = new NavHistory();
    h.push(L(1));
    h.back(L(50));
    h.push(L(2));
    expect(h.forward(L(2))).toBeNull();
  });
  it('연속 동일 위치는 dedupe, 상한 100', () => {
    const h = new NavHistory();
    h.push(L(1));
    h.push(L(1));
    expect(h.back(L(9))).toEqual(L(1));
    expect(h.back(L(1))).toBeNull(); // 중복은 한 번만
    for (let i = 0; i < 150; i++) h.push(L(i));
    expect((h as any).backStack.length).toBeLessThanOrEqual(100);
  });
});
