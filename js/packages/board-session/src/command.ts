import { BoardTarget, LocalRoute, WolfsshRuntime } from './types';

export function buildWolfsshArgs(board: BoardTarget, runtime: WolfsshRuntime): string[] {
  return [
    '-t',
    '-X',
    '-i', runtime.identityFile,
    '-l', board.username,
    '-p', String(board.port ?? 22),
    board.host,
  ];
}

export function buildLocalWolfsshRoute(board: BoardTarget, runtime: WolfsshRuntime): LocalRoute {
  const env = runtime.libraryPath
    ? { ...process.env, LD_LIBRARY_PATH: runtime.libraryPath }
    : { ...process.env };
  return { kind: 'local', executable: runtime.executable, args: buildWolfsshArgs(board, runtime), env };
}

function shellQuote(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteWolfsshCommand(board: BoardTarget, runtime: WolfsshRuntime): string {
  const command = [runtime.executable, ...buildWolfsshArgs(board, runtime)].map(shellQuote).join(' ');
  return runtime.libraryPath
    ? `exec env LD_LIBRARY_PATH=${shellQuote(runtime.libraryPath)} ${command}`
    : `exec ${command}`;
}
