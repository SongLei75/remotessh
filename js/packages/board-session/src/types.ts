export interface BoardTarget {
  host: string;
  port?: number;
  username: string;
}

export interface WolfsshRuntime {
  executable: string;
  identityFile: string;
  libraryPath?: string;
}

export interface LocalRoute {
  kind: 'local';
  executable: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface BatonRoute {
  kind: 'baton';
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string | Buffer;
  agent?: string;
  command: string;
  readyTimeoutMs?: number;
}

export type ExecutionRoute = LocalRoute | BatonRoute;

export interface BoardSessionOptions {
  route: ExecutionRoute;
  maxBufferedChars?: number;
  readyTimeoutMs?: number;
}

export type BoardStream = 'stdout' | 'stderr';
export interface BoardDataEvent { stream: BoardStream; data: string; }
export interface OutputSnapshot { text: string; nextOffset: number; truncatedBeforeOffset: number; }
export interface RunResult extends OutputSnapshot { completed: boolean; exitCode?: number; }
