import * as os from 'node:os';
import * as path from 'node:path';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import {
  BoardSession,
  buildLocal,
  buildRemote,
} from '@songlei/board-session';

const execFileAsync = promisify(execFile);

const DIRECT_PORT = 22021;
const GCP_BOARD = {
  host: '2600:1900:4041:46c:0:2:0:0',
  port: 2222,
  username: 'songlei',
};
const LOCAL_IDENTITY = path.join(os.homedir(), '.ssh/client-identity.pem');
const JUMP_IDENTITY = '/home/ubuntu/.ssh/client-identity.pem';

let directTunnel: ChildProcess | undefined;

export async function openDirectDemo(): Promise<BoardSession> {
  await startDirectTunnel();
  try {
    return await BoardSession.open(buildLocal(
      { host: '127.0.0.1', port: DIRECT_PORT, username: GCP_BOARD.username },
      LOCAL_IDENTITY,
    ));
  } catch (error) {
    await stopDirectTunnel();
    throw error;
  }
}

export async function openJumpDemo(): Promise<BoardSession> {
  return BoardSession.open(await resolveJumpRoute());
}

export async function closeDemoSession(session?: BoardSession): Promise<void> {
  await session?.close();
  await stopDirectTunnel();
}

async function startDirectTunnel(): Promise<void> {
  if (await isDirectPortListening()) {
    throw new Error(`Direct IAP port ${DIRECT_PORT} is already in use`);
  }

  const child = spawn('/snap/bin/gcloud', [
    'compute', 'start-iap-tunnel', 'gcp-free-dev', '2222',
    `--local-host-port=127.0.0.1:${DIRECT_PORT}`,
    '--project=gen-lang-client-0429627202',
    '--zone=us-west1-b',
    '--verbosity=warning',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  directTunnel = child;

  let errorText = '';
  child.stderr?.on('data', data => { errorText += data.toString(); });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      directTunnel = undefined;
      throw new Error(`gcloud IAP tunnel exited: ${errorText.trim() || child.exitCode}`);
    }
    if (await isDirectPortListening()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await stopDirectTunnel();
  throw new Error('gcloud IAP tunnel did not become ready');
}

async function stopDirectTunnel(): Promise<void> {
  const child = directTunnel;
  directTunnel = undefined;
  if (!child || child.exitCode !== null) return;

  child.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function isDirectPortListening(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ss', ['-ltnH', 'sport', '=', `:${DIRECT_PORT}`]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function resolveJumpRoute() {
  const { stdout } = await execFileAsync('ssh', ['-G', 'gcpp'], { maxBuffer: 1024 * 1024 });
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const split = line.indexOf(' ');
    if (split > 0 && !values.has(line.slice(0, split))) {
      values.set(line.slice(0, split), line.slice(split + 1));
    }
  }

  const host = values.get('hostname');
  const username = values.get('user');
  const identity = values.get('identityfile');
  if (!host || !username || !identity) {
    throw new Error('Host gcpp must define hostname, user, and identityfile');
  }

  const identityFile = identity.startsWith('~/')
    ? path.join(os.homedir(), identity.slice(2))
    : identity;

  return {
    kind: 'jump' as const,
    host,
    port: Number(values.get('port') ?? 22),
    username,
    privateKey: await fs.readFile(identityFile),
    command: buildRemote(GCP_BOARD, JUMP_IDENTITY),
  };
}
