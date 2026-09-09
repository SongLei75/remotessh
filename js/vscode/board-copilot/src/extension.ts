import * as vscode from 'vscode';
import { BoardSessionManager } from './sessionManager';
import {
  GetTerminalOutputTool,
  KillTerminalTool,
  OpenSessionTool,
  RunInTerminalTool,
  SendToTerminalTool,
} from './tools';

export function activate(context: vscode.ExtensionContext): void {
  const sessions = new BoardSessionManager(context);
  context.subscriptions.push(sessions);
  context.subscriptions.push(
    vscode.lm.registerTool('board-copilot_openSession', new OpenSessionTool(sessions)),
    vscode.lm.registerTool('board-copilot_runInTerminal', new RunInTerminalTool(sessions)),
    vscode.lm.registerTool('board-copilot_getTerminalOutput', new GetTerminalOutputTool(sessions)),
    vscode.lm.registerTool('board-copilot_sendToTerminal', new SendToTerminalTool(sessions)),
    vscode.lm.registerTool('board-copilot_killTerminal', new KillTerminalTool(sessions)),
    vscode.commands.registerCommand('board-copilot.clearBatonPasswords', async () => {
      await sessions.clearBatonPasswords();
      void vscode.window.showInformationMessage('Board Copilot: saved Baton passwords for this extension session were cleared.');
    }),
  );
}

export function deactivate(): void {
  // BoardSessionManager is disposed by VS Code through context.subscriptions.
}
