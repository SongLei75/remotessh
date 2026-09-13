import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { BoardDataEvent, BoardSessionOptions, OutputSnapshot, RunResult } from './types';
import { createTransport, SessionTransport } from './transport';

export class BoardSession extends EventEmitter {
  private readonly transport: SessionTransport;
  private readonly maxBufferedChars: number;
  private buffer = '';
  private baseOffset = 0;
  private started = false;
  private closed = false;

  constructor(private readonly options: BoardSessionOptions) {
    super();
    this.maxBufferedChars = options.maxBufferedChars ?? 2_000_000;
    this.transport = createTransport(options.route);
    this.transport.events.on('data', (event: BoardDataEvent) => this.onData(event));
    this.transport.events.on('exit', event => { this.closed = true; this.emit('exit', event); });
    this.transport.events.on('close', () => { this.closed = true; this.emit('close'); });
    this.transport.events.on('error', error => this.emit('error', error));
  }

  get isStarted(): boolean { return this.started; }
  get isClosed(): boolean { return this.closed; }
  get currentOffset(): number { return this.baseOffset + this.buffer.length; }

  private onData(event: BoardDataEvent): void {
    this.buffer += event.data;
    if (this.buffer.length > this.maxBufferedChars) {
      const remove = this.buffer.length - this.maxBufferedChars;
      this.buffer = this.buffer.slice(remove);
      this.baseOffset += remove;
    }
    this.emit('data', event);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.transport.start();
    this.started = true;
    await this.waitUntilReady(this.options.readyTimeoutMs ?? 10000);
  }

  private async waitUntilReady(timeoutMs: number): Promise<void> {
    const marker = `__BOARD_READY_${randomBytes(12).toString('hex')}__`;
    const fromOffset = this.currentOffset;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline && !this.closed && this.currentOffset === fromOffset) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (this.closed || this.currentOffset === fromOffset) {
      throw new Error(`board shell did not become ready within ${timeoutMs} ms`);
    }

    this.transport.write(`printf '\\n${marker}\\n'\r`);
    while (Date.now() < deadline && !this.closed) {
      if (this.snapshot(fromOffset).text.includes(marker)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`board shell did not become ready within ${timeoutMs} ms`);
  }

  write(data: string | Buffer): void {
    if (!this.started || this.closed) throw new Error('board session is not active');
    this.transport.write(data);
  }

  snapshot(fromOffset = this.baseOffset): OutputSnapshot {
    const start = Math.max(fromOffset, this.baseOffset);
    const localStart = start - this.baseOffset;
    return {
      text: this.buffer.slice(localStart),
      nextOffset: this.currentOffset,
      truncatedBeforeOffset: this.baseOffset,
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
        const markerIndex = match.index;
        const after = markerIndex + match[0].length;
        const clean = snap.text.slice(0, markerIndex) + snap.text.slice(after);
        return {
          text: clean,
          nextOffset: snap.nextOffset,
          truncatedBeforeOffset: snap.truncatedBeforeOffset,
          completed: true,
          exitCode: Number(match[1]),
        };
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }

    const snap = this.snapshot(fromOffset);
    return { ...snap, completed: false };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.kill();
  }
}
