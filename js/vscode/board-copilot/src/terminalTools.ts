import * as vscode from 'vscode';
import { BoardSession } from '@songlei/board-session';

export const TERMINAL_TOOL_NAMES = new Set([
  'run_in_terminal',
  'get_terminal_output',
  'send_to_terminal',
  'kill_terminal',
]);

const TERMINAL_BYPASS_TOOLS = new Set([
  'execution_subagent',
  'runSubagent',
  'create_and_run_task',
  'run_task',
  'get_task_output',
]);

function textResult(value: unknown): vscode.LanguageModelToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function stringField(input: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = input[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function numberField(input: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = input[name];
    if (typeof value === 'number') return value;
  }
  return undefined;
}

export function modelTools(): vscode.LanguageModelChatTool[] {
  const nativeTerminalTools = vscode.lm.tools.filter(tool => TERMINAL_TOOL_NAMES.has(tool.name));
  const passthroughTools = vscode.lm.tools.filter(
    tool => !TERMINAL_TOOL_NAMES.has(tool.name) && !TERMINAL_BYPASS_TOOLS.has(tool.name),
  );
  return [...passthroughTools, ...nativeTerminalTools]
    .map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
}

export async function invokeTerminalTool(
  session: BoardSession,
  closeSession: () => Promise<void>,
  name: string,
  inputValue: object,
): Promise<vscode.LanguageModelToolResult> {
  const input = inputValue as Record<string, unknown>;

  switch (name) {
    case 'run_in_terminal': {
      const command = stringField(input, 'command', 'cmd', 'commandLine');
      if (!command) return textResult('Missing command');
      const timeout = numberField(input, 'timeout', 'timeoutMs') ?? 30000;
      const result = await session.exec(command, timeout);
      return textResult({ terminalId: 'board', output: result.text, exitCode: result.exitCode, completed: result.completed });
    }
    case 'get_terminal_output':
      return textResult({ terminalId: 'board', output: session.read().text });
    case 'send_to_terminal': {
      const text = stringField(input, 'input', 'text', 'data');
      if (text === undefined) return textResult('Missing input');
      const appendNewline = input.appendNewLine === true || input.appendNewline === true;
      const result = await session.send(text, appendNewline);
      return textResult({ terminalId: 'board', output: result.text });
    }
    case 'kill_terminal':
      await closeSession();
      return textResult({ terminalId: 'board', closed: true });
    default:
      throw new Error(`Unsupported terminal tool: ${name}`);
  }
}
