import * as os from 'node:os';
import * as path from 'node:path';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import {
  BoardSession,
  BoardTarget,
  ExecutionRoute,
  buildLocal,
  buildRemote,
} from '@songlei/board-session';

const execFileAsync = promisify(execFile);

const DIRECT_PORT = 22021;
const GCP_BOARD: BoardTarget = {
  host: '2600:1900:4041:46c:0:2:0:0',
  port: 2222,
  username: 'songlei',
};
const LOCAL_IDENTITY = path.join(os.homedir(), '.ssh/client-identity.pem');
const JUMP_IDENTITY = '/home/ubuntu/.ssh/client-identity.pem';

export class BoardSessionManager {
  private session?: BoardSession;
  private label?: string;
  private cursor = 0;
  private directTunnel?: ChildProcess;

  get activeLabel(): string | undefined { return this.label; }
  get isActive(): boolean { return !!this.session && !this.session.isClosed; }

  async openDirectDemo(): Promise<void> {
    await this.close();
    await this.startDirectTunnel();
    try {
      const route = buildLocal(
        { host: '127.0.0.1', port: DIRECT_PORT, username: GCP_BOARD.username },
        LOCAL_IDENTITY,
      );
      await this.open(route, 'direct:gcp');
    } catch (error) {
      await this.stopDirectTunnel();
      throw error;
    }
  }

  async openJumpDemo(boardName: string, hours: number): Promise<void> {
    await this.close();
    await this.open(await this.resolveJumpRoute(), `jump:${boardName}:${hours}h`);
  }

  async run(command: string, timeoutMs = 30000) {
    if (!this.session) throw new Error('No active board session');
    const result = await this.session.run(command, timeoutMs);
    this.cursor = result.nextOffset;
    return result;
  }

  getOutput() {
    if (!this.session) throw new Error('No active board session');
    const result = this.session.snapshot(this.cursor);
    this.cursor = result.nextOffset;
    return result;
  }

  async send(text: string, appendNewline = false) {
    if (!this.session) throw new Error('No active board session');
    const from = this.cursor;
    this.session.write(text + (appendNewline ? '\r' : ''));
    const result = await this.session.waitForQuiet(from, 200, 1200);
    this.cursor = result.nextOffset;
    return result;
  }

  async close(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    this.label = undefined;
    this.cursor = 0;
    await session?.close();
    await this.stopDirectTunnel();
  }

  private async open(route: ExecutionRoute, label: string): Promise<void> {
    const session = new BoardSession(route);
    await session.start();
    this.session = session;
    this.label = label;
    this.cursor = session.currentOffset;
  }

  private async startDirectTunnel(): Promise<void> {
    if (await this.isDirectPortListening()) {
      throw new Error(`Direct IAP port ${DIRECT_PORT} is already in use`);
    }

    const child = spawn('/snap/bin/gcloud', [
      'compute', 'start-iap-tunnel', 'gcp-free-dev', '2222',
      `--local-host-port=127.0.0.1:${DIRECT_PORT}`,
      '--project=gen-lang-client-0429627202',
      '--zone=us-west1-b',
      '--verbosity=warning',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.directTunnel = child;

    let errorText = '';
    child.stderr?.on('data', data => { errorText += data.toString(); });

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        this.directTunnel = undefined;
        throw new Error(`gcloud IAP tunnel exited: ${errorText.trim() || child.exitCode}`);
      }
      if (await this.isDirectPortListening()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await this.stopDirectTunnel();
    throw new Error('gcloud IAP tunnel did not become ready');
  }

  private async stopDirectTunnel(): Promise<void> {
    const child = this.directTunnel;
    this.directTunnel = undefined;
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

  private async isDirectPortListening(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('ss', ['-ltnH', 'sport', '=', `:${DIRECT_PORT}`]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async resolveJumpRoute(): Promise<ExecutionRoute> {
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
      kind: 'jump',
      host,
      port: Number(values.get('port') ?? 22),
      username,
      privateKey: await fs.readFile(identityFile),
      command: buildRemote(GCP_BOARD, JUMP_IDENTITY),
    };
  }
}
