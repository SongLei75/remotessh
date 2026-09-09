import { BoardTarget, WolfsshRuntime } from './types';

export function buildWolfsshArgs(board: BoardTarget, runtime: WolfsshRuntime): string[] {
  if (runtime.configFile) {
    if (!runtime.destination) {
      throw new Error('wolfssh.destination is required when wolfssh.configFile is set');
    }
    return ['-M', '-F', runtime.configFile, runtime.destination];
  }

  const identity = runtime.identity;
  if (!identity) {
    throw new Error('wolfssh.identity is required for direct board connections');
  }

  const args = [
    '-M',
    '-N',
    '-h', board.host,
    '-p', String(board.port ?? 22),
    '-u', board.username,
    '-c', identity.certificateFile,
    '-i', identity.privateKeyFile,
    '-K', identity.knownHostsFile,
  ];

  if (identity.hostKeyAlias) {
    args.push('-A', identity.hostKeyAlias);
  }
  if (runtime.proxyCommand) {
    args.push('-P', runtime.proxyCommand);
  }
  return args;
}

export function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteWolfsshCommand(board: BoardTarget, runtime: WolfsshRuntime): string {
  return `exec ${[runtime.executable, ...buildWolfsshArgs(board, runtime)].map(shellQuote).join(' ')}`;
}
