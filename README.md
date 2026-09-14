# remotessh

Remote board session layer built on the company wolfSSH client from `../wolf`.

- `js/packages/board-session/`: shared persistent `BoardSession` implementation.
- `js/vscode/board-copilot/`: minimal `@carizon` VS Code chat-participant demo.
- `config/gcpp/baton.ssh_config`: OCI E1 first-hop configuration used by the Baton simulator path.
- `scripts/build-baton-wolfssh.sh`: builds/deploys the E1 test-only wolfSSH binary.
- `scripts/test-direct.sh`: validates local company wolfSSH through a GCP IAP TCP tunnel to the GCP PKIX-SSHD simulator.
- `scripts/test-baton.sh`: validates the OCI Baton path to the same simulator.

Current session paths:

```text
Direct: BoardSession -> local company wolfssh -> IAP TCP tunnel -> GCP PKIX-SSHD
Baton:  BoardSession -> ssh2 -> OCI E1 -> remote company wolfssh -> GCP PKIX-SSHD
```

The E1 simulator build uses `-DTEST_IPV6` only because the E1 -> GCP test hop currently uses IPv6. That flag is test-only and does not belong in the company `wolf` product baseline.
