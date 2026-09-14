import { BoardTarget, LocalRoute, WolfsshCommand } from './types';

export function buildWolfsshCommand(board: BoardTarget, identityFile: string): WolfsshCommand {
  return {
    executable: 'wolfssh',
    args: [
      '-t',
      '-X',
      '-i', identityFile,
      '-l', board.username,
      '-p', String(board.port ?? 22),
      board.host,
    ],
  };
}

export function buildLocalWolfsshRoute(board: BoardTarget, identityFile: string): LocalRoute {
  return { kind: 'local', ...buildWolfsshCommand(board, identityFile) };
}

export function buildDockerWolfsshRoute(
  board: BoardTarget,
  identityFile: string,
  containerId: string,
): LocalRoute {
  const command = buildWolfsshCommand(board, identityFile);
  return {
    kind: 'local',
    executable: 'docker',
    args: ['exec', '-it', containerId, command.executable, ...command.args],
  };
}

function shellQuote(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteWolfsshCommand(board: BoardTarget, identityFile: string): string {
  const command = buildWolfsshCommand(board, identityFile);
  return `exec ${[command.executable, ...command.args].map(shellQuote).join(' ')}`;
}
