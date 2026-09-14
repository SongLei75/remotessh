import { BoardTarget, LocalRoute } from './types';

function buildWolfsshCommand(board: BoardTarget, identityFile: string) {
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

export function buildLocal(board: BoardTarget, identityFile: string): LocalRoute {
  return { kind: 'local', ...buildWolfsshCommand(board, identityFile) };
}

export function buildDocker(board: BoardTarget, identityFile: string, containerId: string): LocalRoute {
  const command = buildWolfsshCommand(board, identityFile);
  return {
    kind: 'local',
    executable: 'docker',
    args: ['exec', '-it', containerId, command.executable, ...command.args],
  };
}

export function buildRemote(board: BoardTarget, identityFile: string): string {
  const command = buildWolfsshCommand(board, identityFile);
  const quote = (value: string) => value ? `'${value.replace(/'/g, `'\\''`)}'` : "''";
  return `exec ${[command.executable, ...command.args].map(quote).join(' ')}`;
}
