export interface BoardTarget {
  host: string;
  port?: number;
  username: string;
}

export interface WolfsshIdentity {
  certificateFile: string;
  privateKeyFile: string;
  knownHostsFile: string;
  hostKeyAlias?: string;
}

export interface WolfsshRuntime {
  executable: string;
  identity?: WolfsshIdentity;
  /** Optional existing ssh_config profile. If set, direct identity options are not required. */
  configFile?: string;
  destination?: string;
  /** Optional raw byte-stream proxy used by wolfSSH itself, e.g. gcloud IAP. */
  proxyCommand?: string;
}

export interface LocalRoute {
  kind: 'local';
  wolfssh: WolfsshRuntime;
}

export interface BatonRoute {
  kind: 'baton';
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string | Buffer;
  agent?: string;
  /** Optional SHA256 host key fingerprint string, e.g. SHA256:abc... */
  hostFingerprintSha256?: string;
  wolfssh: WolfsshRuntime;
  readyTimeoutMs?: number;
}

export type ExecutionRoute = LocalRoute | BatonRoute;

export interface BoardSessionOptions {
  board: BoardTarget;
  route: ExecutionRoute;
  maxBufferedChars?: number;
}

export type BoardStream = 'stdout' | 'stderr';

export interface BoardDataEvent {
  stream: BoardStream;
  data: string;
}

export interface OutputSnapshot {
  text: string;
  nextOffset: number;
  truncatedBeforeOffset: number;
}

export interface RunResult extends OutputSnapshot {
  completed: boolean;
  exitCode?: number;
}
