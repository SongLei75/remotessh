import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
  BoardSession,
  BoardTarget,
  ExecutionRoute,
  OutputSnapshot,
  WolfsshRuntime,
} from '@songlei/board-session';

export interface OpenSessionInput {
  mode: 'local' | 'baton';
  boardHost: string;
  boardPort?: number;
  boardUser: string;
  batonHost?: string;
  batonPort?: number;
  batonUser?: string;
}

interface ManagedSession {
  id: string;
  label: string;
  session: BoardSession;
  cursor: number;
}

export interface SessionResult {
  sessionId: string;
  output: string;
  nextOffset: number;
  truncatedBeforeOffset: number;
}

function expandPath(value: string): string {
  if (!value) return value;
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  let result = value
    .replace(/\$\{userHome\}/g, os.homedir())
    .replace(/\$\{workspaceFolder\}/g, workspace);
  if (result === '~') return os.homedir();
  if (result.startsWith('~/') || result.startsWith('~\\')) {
    result = path.join(os.homedir(), result.slice(2));
  }
  return result;
}

function setting(name: string): string {
  return vscode.workspace.getConfiguration('boardCopilot').get<string>(name, '').trim();
}

function requiredSetting(name: string): string {
  const value = setting(name);
  if (!value) throw new Error(`Missing VS Code setting: boardCopilot.${name}`);
  return expandPath(value);
}

function buildLocalRuntime(): WolfsshRuntime {
  const executable = expandPath(setting('local.wolfsshPath') || 'wolfssh');
  const configFile = setting('local.configFile');
  const destination = setting('local.destination');
  if (configFile || destination) {
    if (!configFile || !destination) {
      throw new Error('boardCopilot.local.configFile and boardCopilot.local.destination must be set together');
    }
    return { executable, configFile: expandPath(configFile), destination };
  }
  return {
    executable,
    identity: {
      certificateFile: requiredSetting('local.certificateFile'),
      privateKeyFile: requiredSetting('local.privateKeyFile'),
      knownHostsFile: requiredSetting('local.knownHostsFile'),
      hostKeyAlias: setting('local.hostKeyAlias') || undefined,
    },
    proxyCommand: setting('local.proxyCommand') || undefined,
  };
}

function buildBatonRuntime(): WolfsshRuntime {
  const executable = setting('baton.remoteWolfsshPath') || '/opt/boardssh/bin/wolfssh';
  const configFile = setting('baton.remoteConfigFile');
  const destination = setting('baton.remoteDestination');
  if (configFile || destination) {
    if (!configFile || !destination) {
      throw new Error('boardCopilot.baton.remoteConfigFile and boardCopilot.baton.remoteDestination must be set together');
    }
    return { executable, configFile, destination };
  }
  return {
    executable,
    identity: {
      certificateFile: setting('baton.remoteCertificateFile') || '/opt/boardssh/config/client-cert.pem',
      privateKeyFile: setting('baton.remotePrivateKeyFile') || '/opt/boardssh/config/client-key.pem',
      knownHostsFile: setting('baton.remoteKnownHostsFile') || '/opt/boardssh/config/known_hosts',
      hostKeyAlias: setting('baton.remoteHostKeyAlias') || undefined,
    },
  };
}

export class BoardSessionManager implements vscode.Disposable {
  private readonly sessions = new Map<string, ManagedSession>();
  private activeSessionId?: string;
  private readonly passwordKeys = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private getManaged(sessionId?: string): ManagedSession {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active board session. Open one with boardOpen first.');
    const managed = this.sessions.get(id);
    if (!managed) throw new Error(`Board session not found: ${id}`);
    return managed;
  }

  private async batonPassword(input: OpenSessionInput): Promise<string> {
    const key = `board-copilot.baton-password:${input.batonUser}@${input.batonHost}:${input.batonPort ?? 22}`;
    this.passwordKeys.add(key);
    const saved = await this.context.secrets.get(key);
    if (saved) return saved;

    const password = await vscode.window.showInputBox({
      title: 'Board Copilot: Baton password',
      prompt: `Password for ${input.batonUser}@${input.batonHost}:${input.batonPort ?? 22}`,
      password: true,
      ignoreFocusOut: true,
    });
    if (password === undefined) throw new Error('Baton password entry was cancelled');
    if (!password) throw new Error('Baton password is empty');
    await this.context.secrets.store(key, password);
    return password;
  }

  async open(input: OpenSessionInput): Promise<SessionResult & { label: string }> {
    if (!input.mode) throw new Error('Connection mode is required: local or baton');
    if (!input.boardHost?.trim()) throw new Error('Board host/IP is required');
    if (!input.boardUser?.trim()) throw new Error('Board username is required');

    if (this.activeSessionId) {
      await this.kill(this.activeSessionId);
    }

    const board: BoardTarget = {
      host: input.boardHost.trim(),
      port: input.boardPort ?? 22,
      username: input.boardUser.trim(),
    };

    let route: ExecutionRoute;
    if (input.mode === 'local') {
      route = { kind: 'local', wolfssh: buildLocalRuntime() };
    } else {
      if (!input.batonHost?.trim()) throw new Error('Baton host/IP is required for baton mode');
      if (!input.batonUser?.trim()) throw new Error('Baton username is required for baton mode');
      const password = await this.batonPassword(input);
      route = {
        kind: 'baton',
        host: input.batonHost.trim(),
        port: input.batonPort ?? 22,
        username: input.batonUser.trim(),
        password,
        hostFingerprintSha256: setting('baton.hostFingerprintSha256') || undefined,
        wolfssh: buildBatonRuntime(),
      };
    }

    const id = randomUUID();
    const label = `${input.mode}:${board.username}@${board.host}:${board.port}`;
    const session = new BoardSession({ board, route });
    session.on('error', error => {
      console.error(`[Board Copilot ${id}]`, error);
    });
    await session.start();
    const initial = await session.waitForQuiet(0, 200, 1200);
    const managed: ManagedSession = { id, label, session, cursor: initial.nextOffset };
    this.sessions.set(id, managed);
    this.activeSessionId = id;
    return this.result(managed, initial, { label });
  }

  async run(command: string, sessionId?: string, timeoutMs = 10000): Promise<SessionResult & { completed: boolean; exitCode?: number }> {
    const managed = this.getManaged(sessionId);
    const result = await managed.session.run(command, timeoutMs);
    managed.cursor = result.nextOffset;
    return {
      sessionId: managed.id,
      output: result.text,
      nextOffset: result.nextOffset,
      truncatedBeforeOffset: result.truncatedBeforeOffset,
      completed: result.completed,
      exitCode: result.exitCode,
    };
  }

  getOutput(sessionId?: string, fromOffset?: number): SessionResult {
    const managed = this.getManaged(sessionId);
    const snapshot = managed.session.snapshot(fromOffset ?? managed.cursor);
    managed.cursor = snapshot.nextOffset;
    return this.result(managed, snapshot);
  }

  async send(text: string, appendNewline: boolean, sessionId?: string, waitMs = 400): Promise<SessionResult> {
    const managed = this.getManaged(sessionId);
    const from = managed.cursor;
    managed.session.write(text + (appendNewline ? '\n' : ''));
    const snapshot = waitMs > 0
      ? await managed.session.waitForQuiet(from, Math.min(waitMs, 250), waitMs)
      : managed.session.snapshot(from);
    managed.cursor = snapshot.nextOffset;
    return this.result(managed, snapshot);
  }

  async kill(sessionId?: string): Promise<{ sessionId: string; closed: true }> {
    const managed = this.getManaged(sessionId);
    await managed.session.close();
    this.sessions.delete(managed.id);
    if (this.activeSessionId === managed.id) this.activeSessionId = undefined;
    return { sessionId: managed.id, closed: true };
  }

  async clearBatonPasswords(): Promise<void> {
    for (const key of this.passwordKeys) await this.context.secrets.delete(key);
    this.passwordKeys.clear();
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(item => item.session.close().catch(() => undefined)));
    this.sessions.clear();
    this.activeSessionId = undefined;
  }

  private result<T extends object = Record<string, never>>(managed: ManagedSession, snapshot: OutputSnapshot, extra?: T): SessionResult & T {
    return {
      sessionId: managed.id,
      output: snapshot.text,
      nextOffset: snapshot.nextOffset,
      truncatedBeforeOffset: snapshot.truncatedBeforeOffset,
      ...(extra ?? {} as T),
    } as SessionResult & T;
  }
}
