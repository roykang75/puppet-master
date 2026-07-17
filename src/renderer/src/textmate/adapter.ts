// TextMate 토큰 → Monaco TokensProvider. tm scope의 마지막(최상세) scope를 Monaco 토큰 문자열로 사용
// — defineTheme 규칙이 점 표기 접두사 매칭하므로 테마 scope와 자연 정합.
import type * as Monaco from 'monaco-editor';
import type { IGrammar, StateStack } from 'vscode-textmate';

const MAX_LINE_LEN = 10_000; // 초장문 라인은 토크나이즈 생략 (성능 가드)
const TOKENIZE_TIME_LIMIT_MS = 50;

export function tmTokensToMonaco(
  tokens: { startIndex: number; scopes: string[] }[],
): { startIndex: number; scopes: string }[] {
  return tokens.map((t) => ({ startIndex: t.startIndex, scopes: t.scopes[t.scopes.length - 1] ?? '' }));
}

class TmState implements Monaco.languages.IState {
  constructor(public readonly stack: StateStack) {}
  clone(): TmState {
    return new TmState(this.stack);
  }
  equals(other: Monaco.languages.IState): boolean {
    return other instanceof TmState && other.stack === this.stack;
  }
}

export function createTokensProvider(grammar: IGrammar, initial: StateStack): Monaco.languages.TokensProvider {
  return {
    getInitialState: () => new TmState(initial),
    tokenize(line, state) {
      const stack = (state as TmState).stack;
      if (line.length > MAX_LINE_LEN) {
        return { tokens: [{ startIndex: 0, scopes: '' }], endState: state.clone() };
      }
      const r = grammar.tokenizeLine(line, stack, TOKENIZE_TIME_LIMIT_MS);
      return { tokens: tmTokensToMonaco(r.tokens), endState: new TmState(r.ruleStack) };
    },
  };
}
