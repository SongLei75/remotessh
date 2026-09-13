import * as vscode from 'vscode';
import { BoardSessionManager } from './sessionManager';
import { invokeTerminalTool, modelTools, TERMINAL_TOOL_NAMES } from './terminalTools';

const sessions = new BoardSessionManager();

async function subscribe(response: vscode.ChatResponseStream): Promise<void> {
  const board = await vscode.window.showQuickPick(
    ['gcp 1', 'gcp 2', 'gcp 3', 'gcp 4', 'gcp 5'],
    { title: '选择 Baton 板子', placeHolder: '模拟返回的可预约板子' },
  );
  if (!board) return;

  const duration = await vscode.window.showQuickPick(
    ['1小时', '2小时', '3小时'],
    { title: `预约 ${board}`, placeHolder: '选择占用时间' },
  );
  if (!duration) return;

  const hours = Number(duration[0]);
  response.progress(`正在连接 ${board}…`);
  await sessions.openBatonDemo(board, hours);
  response.markdown(`已选择 **${board}**，模拟预约 **${duration}**。当前 BoardSession 通过 OCI Baton 链路连接到 GCP 测试服务器。`);
}

async function connectDirect(response: vscode.ChatResponseStream): Promise<void> {
  const ip = await vscode.window.showInputBox({ title: '板子 IP', prompt: 'Demo 中仅模拟输入' });
  if (ip === undefined) return;
  const user = await vscode.window.showInputBox({ title: '板子用户', prompt: '留空使用 root' });
  if (user === undefined) return;
  const pem = await vscode.window.showInputBox({ title: 'PEM 复合证书路径', prompt: 'Demo 中仅模拟输入' });
  if (pem === undefined) return;

  response.progress('正在连接 Direct 测试服务器…');
  await sessions.openDirectDemo();
  response.markdown('Direct 会话已建立。Demo 忽略上述三个输入值，实际通过 GCP IAP TCP 隧道由本机 company wolfssh 连接测试板。');
}

async function runAgent(
  request: vscode.ChatRequest,
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  if (!sessions.isActive) {
    response.markdown('当前没有板子会话。先使用 `@carizon /board sub` 或 `@carizon /board connect`。');
    return;
  }

  const tools = modelTools();
  const terminalTools = tools.filter(tool => TERMINAL_TOOL_NAMES.has(tool.name));
  if (terminalTools.length !== TERMINAL_TOOL_NAMES.size) {
    const found = terminalTools.map(tool => tool.name).join(', ') || 'none';
    throw new Error(`VS Code terminal tools are unavailable (found: ${found})`);
  }

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(
      `You are the Carizon board assistant. The active board session is ${sessions.activeLabel}. ` +
      'All shell commands for the board MUST use run_in_terminal/get_terminal_output/send_to_terminal/kill_terminal. ' +
      'Those terminal tools are redirected to BoardSession. Never execute board commands through any other execution tool.\n\n' +
      `User request: ${request.prompt}`,
    ),
  ];

  for (let round = 0; round < 8; round++) {
    const reply = await request.model.sendRequest(messages, { tools }, token);
    const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
    const calls: vscode.LanguageModelToolCallPart[] = [];

    for await (const part of reply.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        assistantParts.push(part);
        response.markdown(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        assistantParts.push(part);
        calls.push(part);
      }
    }

    if (!calls.length) return;
    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

    const results: vscode.LanguageModelToolResultPart[] = [];
    for (const call of calls) {
      let result: vscode.LanguageModelToolResult;
      if (TERMINAL_TOOL_NAMES.has(call.name)) {
        response.progress(`Board terminal: ${call.name}`);
        result = await invokeTerminalTool(sessions, call.name, call.input);
      } else {
        result = await vscode.lm.invokeTool(call.name, {
          input: call.input,
          toolInvocationToken: request.toolInvocationToken,
        }, token);
      }
      results.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
    }
    messages.push(vscode.LanguageModelChatMessage.User(results));
  }

  response.markdown('\n\n已达到本次工具调用轮数上限。');
}

async function handleBoardRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  if (request.command !== 'board') {
    response.markdown('使用 `/board` 进入板子协作流程。');
    return;
  }

  const prompt = request.prompt.trim();
  if (prompt === 'sub') {
    await subscribe(response);
    return;
  }
  if (prompt === 'connect') {
    await connectDirect(response);
    return;
  }
  if (!prompt) {
    response.markdown('可使用 `sub` 模拟 Baton 预约，或使用 `connect` 模拟 Direct 连接。');
    return;
  }

  await runAgent(request, response, token);
}

export function activate(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant('carizon', handleBoardRequest);
  context.subscriptions.push(participant, { dispose: () => void sessions.close() });
}

export function deactivate(): void {
  void sessions.close();
}
