import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import { Client, ClientChannel } from 'ssh2';
import { ExecutionRoute, JumpRoute, LocalRoute } from './types';

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

  protected emitData(data: Buffer | string): void {
    const text = data.toString();
    if (text) this.events.emit('data', text);
  }
}

class LocalTransport extends BaseTransport {
  private terminal?: pty.IPty;

  constructor(private readonly route: LocalRoute) { super(); }

  async start(): Promise<void> {
    const terminal = pty.spawn(this.route.executable, this.route.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
    });
    this.terminal = terminal;
    terminal.onData(data => this.emitData(data));
    terminal.onExit(() => {
      this.terminal = undefined;
      this.events.emit('close');
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

class JumpTransport extends BaseTransport {
  private client?: Client;
  private channel?: ClientChannel;

  constructor(private readonly route: JumpRoute) { super(); }

  async start(): Promise<void> {
    const client = new Client();
    this.client = client;
    await new Promise<void>((resolve, reject) => {
      const onReady = () => { client.off('error', onError); resolve(); };
      const onError = (error: Error) => { client.off('ready', onReady); reject(error); };
      client.once('ready', onReady);
      client.once('error', onError);
      client.connect({
        host: this.route.host,
        port: this.route.port ?? 22,
        username: this.route.username,
        privateKey: this.route.privateKey,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        readyTimeout: 15000,
      });
    });
    client.on('error', (error: Error) => this.events.emit('error', error));

    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.exec(this.route.command, { pty: { term: 'xterm-256color', cols: 120, rows: 40 } },
        (error, stream) => error ? reject(error) : resolve(stream));
    });
    this.channel = channel;
    channel.on('data', (data: Buffer) => this.emitData(data));
    channel.stderr.on('data', (data: Buffer) => this.emitData(data));
    channel.on('close', () => { this.events.emit('close'); client.end(); });
    channel.on('error', (error: Error) => this.events.emit('error', error));
  }

  write(data: string | Buffer): void {
    if (!this.channel?.writable) throw new Error('Jump board session is not writable');
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
  return route.kind === 'local' ? new LocalTransport(route) : new JumpTransport(route);
}
