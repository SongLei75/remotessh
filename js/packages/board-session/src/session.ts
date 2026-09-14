import { randomBytes } from 'node:crypto';
import { ExecutionRoute } from './types';
import { createTransport, SessionTransport } from './transport';

const MAX_BUFFERED_CHARS = 2_000_000;
const READY_TIMEOUT_MS = 10_000;

interface OutputSnapshot { text: string; nextOffset: number; }
interface RunResult extends OutputSnapshot { completed: boolean; exitCode?: number; }

export class BoardSession {
  private readonly transport: SessionTransport;
  private buffer = '';
  private baseOffset = 0;
  private started = false;
  private closed = false;
  private failure?: Error;

  constructor(route: ExecutionRoute) {
    this.transport = createTransport(route);
    this.transport.events.on('data', (data: string) => this.onData(data));
    this.transport.events.on('close', () => { this.closed = true; });
    this.transport.events.on('error', (error: Error) => {
      this.failure = error;
      this.closed = true;
    });
  }

  get isClosed(): boolean { return this.closed; }
  get currentOffset(): number { return this.baseOffset + this.buffer.length; }

  private onData(data: string): void {
    this.buffer += data;
    if (this.buffer.length > MAX_BUFFERED_CHARS) {
      const remove = this.buffer.length - MAX_BUFFERED_CHARS;
      this.buffer = this.buffer.slice(remove);
      this.baseOffset += remove;
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    try {
      await this.transport.start();
      this.started = true;
      await this.waitUntilReady(READY_TIMEOUT_MS);
    } catch (error) {
      this.closed = true;
      await this.transport.kill();
      throw error;
    }
  }

  private async waitUntilReady(timeoutMs: number): Promise<void> {
    const marker = `__BOARD_READY_${randomBytes(12).toString('hex')}__`;
    const fromOffset = this.currentOffset;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline && !this.closed && this.currentOffset === fromOffset) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (this.failure) throw this.failure;
    if (this.closed || this.currentOffset === fromOffset) {
      throw new Error(`board shell did not become ready within ${timeoutMs} ms`);
    }

    this.transport.write(`printf '\\n${marker}\\n'\r`);
    while (Date.now() < deadline && !this.closed) {
      if (this.snapshot(fromOffset).text.includes(marker)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (this.failure) throw this.failure;
    throw new Error(`board shell did not become ready within ${timeoutMs} ms`);
  }

  write(data: string | Buffer): void {
    if (this.failure) throw this.failure;
    if (!this.started || this.closed) throw new Error('board session is not active');
    this.transport.write(data);
  }

  snapshot(fromOffset = this.baseOffset): OutputSnapshot {
    const start = Math.max(fromOffset, this.baseOffset);
    return {
      text: this.buffer.slice(start - this.baseOffset),
      nextOffset: this.currentOffset,
    };
  }

  async waitForQuiet(fromOffset: number, quietMs = 250, timeoutMs = 2000): Promise<OutputSnapshot> {
    const startTime = Date.now();
    let lastChange = Date.now();
    let lastOffset = this.currentOffset;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, Math.min(quietMs, 50)));
      if (this.currentOffset !== lastOffset) {
        lastOffset = this.currentOffset;
        lastChange = Date.now();
      } else if (Date.now() - lastChange >= quietMs) {
        break;
      }
      if (this.closed) break;
    }
    if (this.failure) throw this.failure;
    return this.snapshot(fromOffset);
  }

  async run(command: string, timeoutMs = 10000): Promise<RunResult> {
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
        return {
          text: snap.text.slice(0, match.index) + snap.text.slice(match.index + match[0].length),
          nextOffset: snap.nextOffset,
          completed: true,
          exitCode: Number(match[1]),
        };
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }

    if (this.failure) throw this.failure;
    return { ...this.snapshot(fromOffset), completed: false };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.kill();
  }
}
