import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { BoardSession, ExecutionRoute, resolveBundledWolfssh } from '@songlei/board-session';

type Args = Record<string, string | boolean>;

function usage(): never {
  console.error(`board-demo.exe <local|baton> --board-host HOST --board-user USER [options]

Local:
  --board-port PORT              default 22
  --cert FILE                    X.509 client certificate
  --key FILE                     private key
  --known-hosts FILE             board known_hosts
  --host-key-alias NAME          optional known_hosts alias
  --wolfssh FILE                 optional native client override

Baton:
  --baton-host HOST
  --baton-port PORT              default 22
  --baton-user USER
  --baton-host-fingerprint SHA256:BASE64   optional but recommended
  Baton password is read from BOARD_BATON_PASSWORD or prompted securely.

Remote wolfSSH defaults:
  --remote-wolfssh /opt/boardssh/bin/wolfssh
  --remote-cert /opt/boardssh/config/client-cert.pem
  --remote-key /opt/boardssh/config/client-key.pem
  --remote-known-hosts /opt/boardssh/config/known_hosts
  --remote-host-key-alias NAME

During the interactive session, Ctrl+] disconnects locally. Other input, including Ctrl+C,
is forwarded to the board terminal.`);
  process.exit(2);
}

function parseArgs(argv: string[]): { mode: 'local' | 'baton'; args: Args } {
  if (argv.length < 1 || (argv[0] !== 'local' && argv[0] !== 'baton')) usage();
  const mode = argv[0] as 'local' | 'baton';
  const args: Args = {};
  for (let i = 1; i < argv.length; ++i) {
    const item = argv[i];
    if (item === '--help' || item === '-h') usage();
    if (!item.startsWith('--')) usage();
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      args[item.slice(2)] = true;
      continue;
    }
    args[item.slice(2)] = argv[++i];
  }
  return { mode, args };
}

function required(args: Args, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value) {
    console.error(`missing --${name}`);
    usage();
  }
  return value;
}

function optional(args: Args, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value ? value : undefined;
}

function port(args: Args, name: string, fallback: number): number {
  const value = optional(args, name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`invalid --${name}: ${value}`);
  }
  return parsed;
}

async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Baton password is not in BOARD_BATON_PASSWORD and stdin is not a TTY');
  }
  const input = process.stdin;
  const wasRaw = input.isRaw ?? false;
  input.setRawMode?.(true);
  input.resume();
  process.stderr.write(prompt);
  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          process.stderr.write('^C\n');
          reject(new Error('password entry cancelled'));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stderr.write('\b \b');
          }
          continue;
        }
        if (byte >= 32) {
          value += Buffer.from([byte]).toString();
          process.stderr.write('*');
        }
      }
    };
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode?.(wasRaw);
      input.pause();
    };
    input.on('data', onData);
  });
}

interface NativeLease {
  path: string;
  cleanup(): void;
}

function acquireNativeWolfssh(override?: string): NativeLease {
  if (override) return { path: override, cleanup() {} };

  if (!isSea()) {
    return { path: resolveBundledWolfssh(), cleanup() {} };
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-wolfssh-'));
  const target = path.join(root, 'wolfssh.exe');
  const asset = getAsset('wolfssh.exe');
  fs.writeFileSync(target, new Uint8Array(asset));
  return {
    path: target,
    cleanup() {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

async function main(): Promise<void> {
  const { mode, args } = parseArgs(process.argv.slice(2));
  const board = {
    host: required(args, 'board-host'),
    port: port(args, 'board-port', 22),
    username: required(args, 'board-user'),
  };

  let nativeLease: NativeLease | undefined;
  let route: ExecutionRoute;

  if (mode === 'local') {
    nativeLease = acquireNativeWolfssh(optional(args, 'wolfssh'));
    route = {
      kind: 'local',
      wolfssh: {
        executable: nativeLease.path,
        identity: {
          certificateFile: required(args, 'cert'),
          privateKeyFile: required(args, 'key'),
          knownHostsFile: required(args, 'known-hosts'),
          hostKeyAlias: optional(args, 'host-key-alias'),
        },
      },
    };
  } else {
    const password = process.env.BOARD_BATON_PASSWORD ?? await readPassword('Baton password: ');
    if (!password) throw new Error('Baton password is empty');
    route = {
      kind: 'baton',
      host: required(args, 'baton-host'),
      port: port(args, 'baton-port', 22),
      username: required(args, 'baton-user'),
      password,
      hostFingerprintSha256: optional(args, 'baton-host-fingerprint'),
      wolfssh: {
        executable: optional(args, 'remote-wolfssh') ?? '/opt/boardssh/bin/wolfssh',
        identity: {
          certificateFile: optional(args, 'remote-cert') ?? '/opt/boardssh/config/client-cert.pem',
          privateKeyFile: optional(args, 'remote-key') ?? '/opt/boardssh/config/client-key.pem',
          knownHostsFile: optional(args, 'remote-known-hosts') ?? '/opt/boardssh/config/known_hosts',
          hostKeyAlias: optional(args, 'remote-host-key-alias'),
        },
      },
    };
  }

  const session = new BoardSession({ board, route });
  let closed = false;
  const wasRaw = process.stdin.isTTY ? (process.stdin.isRaw ?? false) : false;

  const close = async (code = 0) => {
    if (closed) return;
    closed = true;
    try { process.stdin.setRawMode?.(wasRaw); } catch { /* ignore */ }
    try { await session.close(); } catch { /* ignore */ }
    nativeLease?.cleanup();
    process.exitCode = code;
  };

  session.on('data', event => {
    (event.stream === 'stderr' ? process.stderr : process.stdout).write(event.data);
  });
  session.on('error', error => process.stderr.write(`\nboard session error: ${String(error)}\n`));
  session.on('exit', async () => { await close(process.exitCode ?? 0); });

  try {
    await session.start();
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', async (chunk: Buffer) => {
      const escapeAt = chunk.indexOf(0x1d); // Ctrl+]
      if (escapeAt >= 0) {
        if (escapeAt > 0) session.write(chunk.subarray(0, escapeAt));
        process.stderr.write('\nDisconnected.\n');
        await close(0);
        return;
      }
      session.write(chunk);
    });
    process.stdin.on('end', async () => { await close(0); });
  } catch (error) {
    process.stderr.write(`board-demo: ${error instanceof Error ? error.message : String(error)}\n`);
    await close(1);
  }
}

void main();
