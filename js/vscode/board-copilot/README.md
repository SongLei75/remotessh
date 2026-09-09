# Board Copilot

VS Code extension tools that give Copilot Agent a persistent board terminal backed by wolfSSH.

Two execution routes share the same `BoardSession` implementation:

- **local**: VS Code -> local `wolfssh` -> board
- **baton**: VS Code -> SSH2 -> Baton container -> remote `wolfssh` -> board

The Baton password is collected through VS Code's masked input and stored in `SecretStorage`; it is never passed to the language model as a tool argument.

## Copilot tools

- `#boardOpen` - open one persistent board session
- `#boardRun` - run a command in that shell and capture its exit status
- `#boardOutput` - read additional output
- `#boardSend` - send raw input to an interactive process
- `#boardKill` - close the session

After `boardOpen`, the tool result instructs the model to use these board tools for subsequent board terminal operations.

> VS Code extensions cannot replace or intercept the built-in terminal tool. For strict routing, disable the built-in terminal tool in Copilot's Tools customization for that workflow, leaving the Board Copilot tools enabled.

## Identity configuration

The user-facing connection request only needs board host/user/port and, for Baton, Baton host/user/port. X.509 paths and wolfSSH executable paths are configured once in VS Code settings under `Board Copilot`.

For direct local connections set:

- `boardCopilot.local.wolfsshPath`
- `boardCopilot.local.certificateFile`
- `boardCopilot.local.privateKeyFile`
- `boardCopilot.local.knownHostsFile`

For Baton, the default remote deployment layout is `/opt/boardssh/{bin,config}` and can be changed with the `boardCopilot.baton.*` settings.
