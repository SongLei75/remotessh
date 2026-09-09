import * as vscode from 'vscode';
import { BoardSessionManager, OpenSessionInput } from './sessionManager';

function jsonResult(value: unknown): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify(value, null, 2)),
  ]);
}

function errorResult(error: unknown): vscode.LanguageModelToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return jsonResult({ ok: false, error: message });
}

interface OpenInput extends OpenSessionInput {}
interface RunInput { command: string; sessionId?: string; timeoutMs?: number; }
interface OutputInput { sessionId?: string; fromOffset?: number; }
interface SendInput { text: string; appendNewline?: boolean; sessionId?: string; waitMs?: number; }
interface KillInput { sessionId?: string; }

export class OpenSessionTool implements vscode.LanguageModelTool<OpenInput> {
  constructor(private readonly sessions: BoardSessionManager) {}

  async invoke(options: vscode.LanguageModelToolInvocationOptions<OpenInput>, token: vscode.CancellationToken) {
    if (token.isCancellationRequested) return errorResult('Cancelled');
    try {
      const result = await this.sessions.open(options.input);
      return jsonResult({
        ok: true,
        ...result,
        instruction: 'Board session is active. For subsequent commands intended for this board, use boardRun, boardOutput, boardSend, and boardKill instead of the built-in VS Code terminal tool.',
      });
    } catch (error) {
      return errorResult(error);
    }
  }

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<OpenInput>) {
    const input = options.input;
    const board = `${input.boardUser ?? '?'}@${input.boardHost ?? '?'}:${input.boardPort ?? 22}`;
    const route = input.mode === 'baton'
      ? `Baton ${input.batonUser ?? '?'}@${input.batonHost ?? '?'}:${input.batonPort ?? 22}`
      : 'Local wolfSSH';
    return {
      invocationMessage: `Opening board terminal ${board} via ${route}`,
      confirmationMessages: {
        title: 'Open wolfSSH board terminal?',
        message: new vscode.MarkdownString(`Connect to **${board}** via **${route}**?`),
      },
    };
  }
}

export class RunInTerminalTool implements vscode.LanguageModelTool<RunInput> {
  constructor(private readonly sessions: BoardSessionManager) {}

  async invoke(options: vscode.LanguageModelToolInvocationOptions<RunInput>, token: vscode.CancellationToken) {
    if (token.isCancellationRequested) return errorResult('Cancelled');
    try {
      const result = await this.sessions.run(
        options.input.command,
        options.input.sessionId,
        options.input.timeoutMs ?? 10000,
      );
      return jsonResult({ ok: true, ...result });
    } catch (error) {
      return errorResult(error);
    }
  }

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RunInput>) {
    return {
      invocationMessage: 'Running command in wolfSSH board terminal',
      confirmationMessages: {
        title: 'Run command on board?',
        message: new vscode.MarkdownString(`Run on the active board session?\n\n\`\`\`sh\n${options.input.command}\n\`\`\``),
      },
    };
  }
}

export class GetTerminalOutputTool implements vscode.LanguageModelTool<OutputInput> {
  constructor(private readonly sessions: BoardSessionManager) {}

  async invoke(options: vscode.LanguageModelToolInvocationOptions<OutputInput>, token: vscode.CancellationToken) {
    if (token.isCancellationRequested) return errorResult('Cancelled');
    try {
      return jsonResult({ ok: true, ...this.sessions.getOutput(options.input.sessionId, options.input.fromOffset) });
    } catch (error) {
      return errorResult(error);
    }
  }

  async prepareInvocation() {
    return { invocationMessage: 'Reading wolfSSH board terminal output' };
  }
}

export class SendToTerminalTool implements vscode.LanguageModelTool<SendInput> {
  constructor(private readonly sessions: BoardSessionManager) {}

  async invoke(options: vscode.LanguageModelToolInvocationOptions<SendInput>, token: vscode.CancellationToken) {
    if (token.isCancellationRequested) return errorResult('Cancelled');
    try {
      const result = await this.sessions.send(
        options.input.text,
        options.input.appendNewline ?? false,
        options.input.sessionId,
        options.input.waitMs ?? 400,
      );
      return jsonResult({ ok: true, ...result });
    } catch (error) {
      return errorResult(error);
    }
  }

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<SendInput>) {
    const rendered = options.input.text.length > 200
      ? `${options.input.text.slice(0, 200)}…`
      : options.input.text;
    return {
      invocationMessage: 'Sending input to wolfSSH board terminal',
      confirmationMessages: {
        title: 'Send input to board terminal?',
        message: new vscode.MarkdownString(`Send this input${options.input.appendNewline ? ' followed by Enter' : ''}?\n\n\`\`\`text\n${rendered}\n\`\`\``),
      },
    };
  }
}

export class KillTerminalTool implements vscode.LanguageModelTool<KillInput> {
  constructor(private readonly sessions: BoardSessionManager) {}

  async invoke(options: vscode.LanguageModelToolInvocationOptions<KillInput>, token: vscode.CancellationToken) {
    if (token.isCancellationRequested) return errorResult('Cancelled');
    try {
      return jsonResult({ ok: true, ...(await this.sessions.kill(options.input.sessionId)) });
    } catch (error) {
      return errorResult(error);
    }
  }

  async prepareInvocation() {
    return {
      invocationMessage: 'Closing wolfSSH board terminal',
      confirmationMessages: {
        title: 'Close board terminal?',
        message: new vscode.MarkdownString('Close the active wolfSSH board session and release its route resources?'),
      },
    };
  }
}
