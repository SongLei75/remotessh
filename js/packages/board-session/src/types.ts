export interface BoardTarget {
  host: string;
  port?: number;
  username: string;
}

export interface LocalRoute {
  kind: 'local';
  executable: string;
  args: string[];
}

export interface JumpRoute {
  kind: 'jump';
  host: string;
  port?: number;
  username: string;
  privateKey: string | Buffer;
  command: string;
}

export type ExecutionRoute = LocalRoute | JumpRoute;
