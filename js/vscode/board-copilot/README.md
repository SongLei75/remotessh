# Carizon Board Demo

Minimal VS Code chat participant for validating the shared `@songlei/board-session` layer before moving it into the company collaborator extension.

- `@carizon /board sub` — choose one of five simulated GCP boards, choose 1/2/3 hours, then connect through the existing `gcpp` jump-server configuration.
- `@carizon /board connect` — collect board IP/user/composite PEM inputs, then ignore them in the demo and use local company wolfSSH with the real composite PEM through a temporary GCP IAP TCP tunnel to the PKIX-SSHD simulator.
- `@carizon /board <request>` — send the request to the selected model with the normal VS Code tool list, except terminal execution is intercepted and routed through the active `BoardSession`.

The terminal tool names, descriptions, and input schemas are taken from `vscode.lm.tools` at runtime. The native implementations of `run_in_terminal`, `get_terminal_output`, `send_to_terminal`, and `kill_terminal` are not invoked inside the `@carizon` participant.

The plugin only owns demo connection setup and UI state. Terminal tools call `BoardSession.exec/read/send/close` directly; session buffering and cursor state stay inside `@songlei/board-session`.

Demo transport paths:

- Direct: `BoardSession -> local company wolfssh -> IAP TCP tunnel -> GCP PKIX-SSHD`
- JumpServer: `BoardSession -> ssh2 -> OCI E1 -> remote company wolfssh -> GCP PKIX-SSHD`
