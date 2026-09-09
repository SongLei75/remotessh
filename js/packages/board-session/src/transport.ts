import { EventEmitter } from 'node:events';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { timingSafeEqual, createHash } from 'node:crypto';
import { Client, ClientChannel } from 'ssh2';
import { BatonRoute, BoardDataEvent, BoardTarget, LocalRoute } from './types';
import { buildRemoteWolfsshCommand, buildWolfsshArgs } from './command';

const READY_MARKER = '__BOARDSSH_READY__\n';

export interface SessionTransport {
  readonly events: EventEmitter;
  start(): Promise<void>;
  write(data: string | Buffer): void;
  kill(): Promise<void>;
}

abstract class BaseTransport implements SessionTransport {
  readonly events = new EventEmitter();
  private machineStderr = '';
  private ready = false;

  abstract start(): Promise<void>;
  abstract write(data: string | Buffer): void;
  abstract kill(): Promise<void>;

  protected emitData(stream: BoardDataEvent['stream'], data: Buffer | string): void {
    const text = data.toString();
    if (text.length > 0) {
      this.events.emit('data', { stream, data: text } satisfies BoardDataEvent);
    }
  }

  protected handleMachineStderr(data: Buffer | string): void {
    if (this.ready) {
      this.emitData('stderr', data);
      return;
    }

    this.machineStderr += data.toString();
    const markerAt = this.machineStderr.indexOf(READY_MARKER);
    if (markerAt < 0) {
      /* Keep enough suffix to detect a marker split across chunks. */
      const keep = READY_MARKER.length - 1;
      if (this.machineStderr.length > keep) {
        const flush = this.machineStderr.slice(0, this.machineStderr.length - keep);
        this.machineStderr = this.machineStderr.slice(-keep);
        this.emitData('stderr', flush);
      }
      return;
    }

    const before = this.machineStderr.slice(0, markerAt);
    const after = this.machineStderr.slice(markerAt + READY_MARKER.length);
    this.machineStderr = '';
    this.ready = true;
    this.emitData('stderr', before);
    this.events.emit('ready');
    this.emitData('stderr', after);
  }

  protected async waitReady(timeoutMs: number): Promise<void> {
    if (this.ready) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`wolfSSH board login did not become ready within ${timeoutMs} ms`));
      }, timeoutMs);
      const onReady = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onExit = (event: unknown) => { cleanup(); reject(new Error(`wolfssh exited before board login was ready: ${JSON.stringify(event)}`)); };
      const cleanup = () => {
        clearTimeout(timer);
        this.events.off('ready', onReady);
        this.events.off('error', onError);
        this.events.off('exit', onExit);
      };
      this.events.once('ready', onReady);
      this.events.once('error', onError);
      this.events.once('exit', onExit);
    });
  }
}

export class LocalTransport extends BaseTransport {
  private child?: ChildProcessWithoutNullStreams;

  constructor(private readonly board: BoardTarget, private readonly route: LocalRoute) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('local wolfssh transport already started');

    const args = buildWolfsshArgs(this.board, this.route.wolfssh);
    const child = spawn(this.route.wolfssh.executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });
    this.child = child;

    child.stdout.on('data', (data: Buffer) => this.emitData('stdout', data));
    child.stderr.on('data', (data: Buffer) => this.handleMachineStderr(data));
    child.on('exit', (code, signal) => this.events.emit('exit', { code, signal }));
    child.on('error', error => this.events.emit('error', error));

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => {
        child.off('spawn', onSpawn);
        child.off('error', onError);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
    await this.waitReady(30000);
  }

  write(data: string | Buffer): void {
    if (!this.child || this.child.stdin.destroyed) {
      throw new Error('local wolfssh transport is not writable');
    }
    this.child.stdin.write(data);
  }

  async kill(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    if (!child.killed) child.kill('SIGTERM');
    await new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
        resolve();
      }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

function normalizeFingerprint(value: string): string {
  return value.trim().replace(/^SHA256:/i, '').replace(/=+$/g, '');
}

export class BatonTransport extends BaseTransport {
  private client?: Client;
  private channel?: ClientChannel;

  constructor(private readonly board: BoardTarget, private readonly route: BatonRoute) {
    super();
  }

  async start(): Promise<void> {
    if (this.client) throw new Error('Baton transport already started');

    if (!this.route.password && !this.route.privateKey && !this.route.agent) {
      throw new Error('Baton route requires password, privateKey, or agent authentication');
    }

    const client = new Client();
    this.client = client;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Baton SSH connection timed out')), this.route.readyTimeoutMs ?? 15000);
      const cleanup = () => clearTimeout(timeout);
      client.once('ready', () => { cleanup(); resolve(); });
      client.once('error', error => { cleanup(); reject(error); });
      client.connect({
        host: this.route.host,
        port: this.route.port ?? 22,
        username: this.route.username,
        password: this.route.password,
        privateKey: this.route.privateKey,
        agent: this.route.agent,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        hostVerifier: this.route.hostFingerprintSha256
          ? (key: Buffer) => {
              const expected = Buffer.from(normalizeFingerprint(this.route.hostFingerprintSha256!), 'base64');
              const actual = createHash('sha256').update(key).digest();
              return expected.length === actual.length && timingSafeEqual(expected, actual);
            }
          : undefined,
      });
    });

    const command = buildRemoteWolfsshCommand(this.board, this.route.wolfssh);
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.exec(command, { pty: false }, (error, stream) => error ? reject(error) : resolve(stream));
    });
    this.channel = channel;
    channel.on('data', (data: Buffer) => this.emitData('stdout', data));
    channel.stderr.on('data', (data: Buffer) => this.handleMachineStderr(data));
    channel.on('exit', (code: number | null, signal: string | null) => this.events.emit('exit', { code, signal }));
    channel.on('close', () => this.events.emit('close'));
    channel.on('error', (error: Error) => this.events.emit('error', error));

    await this.waitReady(30000);
  }

  write(data: string | Buffer): void {
    if (!this.channel || !this.channel.writable) {
      throw new Error('Baton wolfssh channel is not writable');
    }
    this.channel.write(data);
  }

  async kill(): Promise<void> {
    const channel = this.channel;
    const client = this.client;
    this.channel = undefined;
    this.client = undefined;
    if (channel) {
      try { channel.signal('TERM'); } catch { /* server/channel already closed */ }
      try { channel.end(); } catch { /* already closed */ }
      await new Promise<void>(resolve => {
        if (channel.destroyed) return resolve();
        const timer = setTimeout(resolve, 750);
        channel.once('close', () => { clearTimeout(timer); resolve(); });
      });
      try { channel.close(); } catch { /* already closed */ }
    }
    if (client) client.end();
  }
}

export function createTransport(board: BoardTarget, route: LocalRoute | BatonRoute): SessionTransport {
  return route.kind === 'local' ? new LocalTransport(board, route) : new BatonTransport(board, route);
}
