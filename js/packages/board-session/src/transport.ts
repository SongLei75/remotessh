import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import { Client, ClientChannel } from 'ssh2';
import { BatonRoute, BoardDataEvent, ExecutionRoute, LocalRoute } from './types';

export interface SessionTransport {
  readonly events: EventEmitter;
  start(): Promise<void>;
  write(data: string | Buffer): void;
  kill(): Promise<void>;
}

abstract class BaseTransport implements SessionTransport {
  readonly events = new EventEmitter();
  abstract start(): Promise<void>;
  abstract write(data: string | Buffer): void;
  abstract kill(): Promise<void>;

  protected emitData(stream: BoardDataEvent['stream'], data: Buffer | string): void {
    const text = data.toString();
    if (text) this.events.emit('data', { stream, data: text } satisfies BoardDataEvent);
  }
}

class LocalTransport extends BaseTransport {
  private terminal?: pty.IPty;

  constructor(private readonly route: LocalRoute) { super(); }

  async start(): Promise<void> {
    const terminal = pty.spawn(this.route.executable, this.route.args ?? [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      env: this.route.env ?? process.env,
    });
    this.terminal = terminal;
    terminal.onData(data => this.emitData('stdout', data));
    terminal.onExit(({ exitCode, signal }) => {
      this.terminal = undefined;
      this.events.emit('exit', { code: exitCode, signal: signal ?? null });
    });
  }

  write(data: string | Buffer): void {
    if (!this.terminal) throw new Error('local board session is not writable');
    this.terminal.write(data);
  }

  async kill(): Promise<void> {
    const terminal = this.terminal;
    this.terminal = undefined;
    if (terminal) terminal.kill();
  }
}

class BatonTransport extends BaseTransport {
  private client?: Client;
  private channel?: ClientChannel;

  constructor(private readonly route: BatonRoute) { super(); }

  async start(): Promise<void> {
    if (!this.route.password && !this.route.privateKey && !this.route.agent) {
      throw new Error('Baton route requires password, privateKey, or agent authentication');
    }

    const client = new Client();
    this.client = client;
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
      client.connect({
        host: this.route.host,
        port: this.route.port ?? 22,
        username: this.route.username,
        password: this.route.password,
        privateKey: this.route.privateKey,
        agent: this.route.agent,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        readyTimeout: this.route.readyTimeoutMs ?? 15000,
      });
    });

    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.exec(this.route.command, { pty: { term: 'xterm-256color', cols: 120, rows: 40 } },
        (error, stream) => error ? reject(error) : resolve(stream));
    });
    this.channel = channel;
    channel.on('data', (data: Buffer) => this.emitData('stdout', data));
    channel.stderr.on('data', (data: Buffer) => this.emitData('stderr', data));
    channel.on('exit', (code: number | null, signal: string | null) => this.events.emit('exit', { code, signal }));
    channel.on('close', () => this.events.emit('close'));
    channel.on('error', (error: Error) => this.events.emit('error', error));
  }

  write(data: string | Buffer): void {
    if (!this.channel?.writable) throw new Error('Baton board session is not writable');
    this.channel.write(data);
  }

  async kill(): Promise<void> {
    const channel = this.channel;
    const client = this.client;
    this.channel = undefined;
    this.client = undefined;
    try { channel?.end(); } catch {}
    try { channel?.close(); } catch {}
    client?.end();
  }
}

export function createTransport(route: ExecutionRoute): SessionTransport {
  return route.kind === 'local' ? new LocalTransport(route) : new BatonTransport(route);
}
