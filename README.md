# remotessh

Remote SSH development workspace split from `../wolf`.

- `../wolf`: company wolfSSH/wolfSSL snapshot. Treat as read-only unless the company client lacks a required capability.
  - wolfSSH `8643d7be841184f766374e3b0ed68ced6391543c` / 1.5.0 + company patch
  - wolfSSL `1d363f3adceba9d1478230ede476a37b0dcdef24` / 5.9.1
- `js/`: persistent `BoardSession`, Local/Baton transports, and VS Code Copilot tools.
- `native/`: the earlier local native implementation kept as migration/reference code.
- `config/gcpp/`: GCP PKIX-SSH simulator configuration and machine-local identities. Private PKI material is ignored by Git.
- `scripts/test-direct.sh`: company wolfSSH through gcloud IAP to GCP:2222.
- `scripts/test-baton.sh`: company wolfSSH through the `gcpp` OCI E1 IPv6 forwarding route to GCP:2222.

SSH config is included from:

- `config/gcpp/direct.ssh_config` -> `Host gcp`
- `config/gcpp/baton.ssh_config` -> `Host gcpp`
