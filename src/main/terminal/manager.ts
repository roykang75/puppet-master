// PTY 수명/라우팅 — node-pty는 지연 require (로드 실패가 앱 기동에 영향 주지 않도록).
import { buildSpawnSpec, SpawnSpec } from './spawn-spec';

export interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TerminalManagerDeps {
  cwd: string;
  onData(id: number, data: string): void;
  onExit(id: number): void;
  spawnFn?: (spec: SpawnSpec) => PtyLike;
}

function defaultSpawn(spec: SpawnSpec): PtyLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require('node-pty') as {
    spawn(
      file: string,
      args: string[],
      opts: { cwd: string; env: NodeJS.ProcessEnv; name: string; cols: number; rows: number },
    ): {
      onData(cb: (d: string) => void): void;
      // 실제 node-pty는 onExit(cb: (e: {exitCode, signal}) => void). PtyLike의 () => void와
      // 구조적으로 호환되므로 여기서 흡수한다(추가 인자는 무시).
      onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
      write(d: string): void;
      resize(c: number, r: number): void;
      kill(): void;
    };
  };
  const proc = pty.spawn(spec.file, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
  });
  return {
    onData: (cb) => proc.onData(cb),
    onExit: (cb) => proc.onExit(() => cb()),
    write: (d) => proc.write(d),
    resize: (c, r) => proc.resize(c, r),
    kill: () => proc.kill(),
  };
}

export class TerminalManager {
  private ptys = new Map<number, PtyLike>();
  private nextId = 1;
  private readonly spawnFn: (spec: SpawnSpec) => PtyLike;

  constructor(private deps: TerminalManagerDeps) {
    this.spawnFn = deps.spawnFn ?? defaultSpawn;
  }

  spawn(): { id: number } | { error: string } {
    let proc: PtyLike;
    try {
      proc = this.spawnFn(buildSpawnSpec(process.env, this.deps.cwd));
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const id = this.nextId++;
    this.ptys.set(id, proc);
    proc.onData((data) => this.deps.onData(id, data));
    proc.onExit(() => {
      this.ptys.delete(id);
      this.deps.onExit(id);
    });
    return { id };
  }

  input(id: number, data: string): void {
    this.ptys.get(id)?.write(data);
  }

  resize(id: number, cols: number, rows: number): void {
    this.ptys.get(id)?.resize(cols, rows);
  }

  kill(id: number): void {
    const p = this.ptys.get(id);
    if (!p) return;
    this.ptys.delete(id);
    try {
      p.kill();
    } catch {
      // 이미 종료
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }
}
