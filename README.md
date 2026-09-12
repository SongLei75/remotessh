# remotessh

Remote SSH development workspace split from `../wolf`.

- `../wolf`: company wolfSSH/wolfSSL snapshot. Treat as read-only unless the company client lacks a required capability.
  - wolfSSH `8643d7be841184f766374e3b0ed68ced6391543c` / 1.5.0 + company patch
  - wolfSSL `1d363f3adceba9d1478230ede476a37b0dcdef24` / 5.9.1
- `js/`: persistent `BoardSession`, Local/Baton transports, and VS Code Copilot tools.
- `native/`: the earlier local native implementation kept as migration/reference code.
- `config/gcpp/`: GCP PKIX-SSH simulator configuration and machine-local identities. Private PKI material is ignored by Git.
- `scripts/test-direct.sh`: company wolfSSH through gcloud IAP to GCP:2222.
- `scripts/test-baton.sh`: `ssh gcpp` opens OpenSSH to OCI E1, then `RemoteCommand` runs company wolfSSH on E1 to GCP IPv6:2222.

SSH config is included from:

- `config/gcpp/direct.ssh_config` -> `Host gcp`
- `config/gcpp/baton.ssh_config` -> `Host gcpp`


## Baton test runtime

E1 is the only OCI Baton test server. The company source snapshot itself is unchanged.
The E1 runtime uses the company wolfSSH 1.5.0 source built with `-DTEST_IPV6`, because the
company default Linux build selects the IPv4-only branch of wolfSSH's test/client socket
helper. The runtime lives under `~/.local/remotessh/` on E1.
Rebuild that Baton-specific binary with `scripts/build-baton-wolfssh.sh`; generated files stay under ignored `build/`.

`Host gcpp` matches the intended production shape:

```text
local OpenSSH -> OCI E1 -> company wolfssh on E1 -> GCP PKIX-SSHD
```
