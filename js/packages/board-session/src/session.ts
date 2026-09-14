import { randomBytes } from 'node:crypto';
import { ExecutionRoute } from './types';
import { createTransport, SessionTransport } from './transport';

const MAX_BUFFERED_CHARS = 2_000_000;
const READY_TIMEOUT_MS = 10_000;

interface SessionOutput { text: string; }
interface ExecResult extends SessionOutput { completed: boolean; exitCode?: number; }

export class BoardSession {
  private readonly transport: SessionTransport;
  private buffer = '';
  private baseOffset = 0;
  private readOffset = 0;
  private closed = false;
  private failure?: Error;

  private constructor(route: ExecutionRoute) {
    this.transport = createTransport(route);
    this.transport.events.on('data', (data: string) => this.onData(data));
    this.transport.events.on('close', () => { this.closed = true; });
    this.transport.events.on('error', (error: Error) => {
      this.failure = error;
      this.closed = true;
    });
  }

  static async open(route: ExecutionRoute): Promise<BoardSession> {
    const session = new BoardSession(route);
    await session.start();
    session.readOffset = session.currentOffset;
    return session;
  }

  get isClosed(): boolean { return this.closed; }

  private get currentOffset(): number { return this.baseOffset + this.buffer.length; }

  private onData(data: string): void {
    this.buffer += data;
    if (this.buffer.length > MAX_BUFFERED_CHARS) {
      const remove = this.buffer.length - MAX_BUFFERED_CHARS;
      this.buffer = this.buffer.slice(remove);
      this.baseOffset += remove;
    }
  }

  private async start(): Promise<void> {
    try {
      await this.transport.start();
      await this.waitUntilReady();
    } catch (error) {
      this.closed = true;
      await this.transport.kill();
      throw error;
    }
  }

  private async waitUntilReady(): Promise<void> {
    const marker = `__BOARD_READY_${randomBytes(12).toString('hex')}__`;
    const fromOffset = this.currentOffset;
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline && !this.closed && this.currentOffset === fromOffset) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (this.failure) throw this.failure;
    if (this.closed || this.currentOffset === fromOffset) {
      throw new Error(`board shell did not become ready within ${READY_TIMEOUT_MS} ms`);
    }

    this.transport.write(`printf '\\n${marker}\\n'\r`);
    while (Date.now() < deadline && !this.closed) {
      if (this.snapshot(fromOffset).text.includes(marker)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (this.failure) throw this.failure;
    throw new Error(`board shell did not become ready within ${READY_TIMEOUT_MS} ms`);
  }

  private assertActive(): void {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('board session is not active');
  }

  private write(data: string | Buffer): void {
    this.assertActive();
    this.transport.write(data);
  }

  private snapshot(fromOffset: number) {
    const start = Math.max(fromOffset, this.baseOffset);
    return {
      text: this.buffer.slice(start - this.baseOffset),
      nextOffset: this.currentOffset,
    };
  }

  private async waitForQuiet(fromOffset: number, quietMs: number, timeoutMs: number) {
    const startTime = Date.now();
    let lastChange = startTime;
    let lastOffset = this.currentOffset;
    let changed = false;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, Math.min(quietMs, 50)));
      if (this.currentOffset !== lastOffset) {
        lastOffset = this.currentOffset;
        lastChange = Date.now();
        changed = true;
      } else if (changed && Date.now() - lastChange >= quietMs) {
        break;
      }
      if (this.closed) break;
    }
    if (this.failure) throw this.failure;
    return this.snapshot(fromOffset);
  }

  async exec(command: string, timeoutMs = 10000): Promise<ExecResult> {
    if (!command.trim()) throw new Error('command is empty');
    const marker = `__BOARD_DONE_${randomBytes(12).toString('hex')}__`;
    const markerRegex = new RegExp(`${marker}:(-?\\d+)\\r?\\n`);
    const fromOffset = this.currentOffset;
    this.write(`${command}\rprintf '\\n${marker}:%s\\n' "$?"\r`);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.closed) {
      const snap = this.snapshot(fromOffset);
      const match = markerRegex.exec(snap.text);
      if (match) {
        this.readOffset = snap.nextOffset;
        return {
          text: snap.text.slice(0, match.index) + snap.text.slice(match.index + match[0].length),
          completed: true,
          exitCode: Number(match[1]),
        };
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }

    if (this.failure) throw this.failure;
    const snap = this.snapshot(fromOffset);
    this.readOffset = snap.nextOffset;
    return { text: snap.text, completed: false };
  }

  read(): SessionOutput {
    this.assertActive();
    const snap = this.snapshot(this.readOffset);
    this.readOffset = snap.nextOffset;
    return { text: snap.text };
  }

  async send(text: string, appendNewline = false): Promise<SessionOutput> {
    const fromOffset = this.currentOffset;
    this.write(text + (appendNewline ? '\r' : ''));
    const snap = await this.waitForQuiet(fromOffset, 200, 1200);
    this.readOffset = snap.nextOffset;
    return { text: snap.text };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.kill();
  }
}
