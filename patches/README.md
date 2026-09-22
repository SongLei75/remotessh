# Code - OSS BoardSession integration snapshot

`vscode-boardsession-bc66acbf.patch` contains the locally reconstructed BoardSession integration for Code - OSS. It is a Git **binary** patch of 251 files (including the native Linux x64 `.node` and wolfSSH/wolfSSL `.so` files and public headers), relative to:

- Upstream: `microsoft/vscode`
- Base commit: `bc66acbf854b040e1e8a92dedf385e0526145ee6`

Apply at the **VS Code repository root**, not at the `remotessh` root:

```bash
cd /path/to/vscode
git apply --check /path/to/remotessh/patches/vscode-boardsession-bc66acbf.patch
git apply /path/to/remotessh/patches/vscode-boardsession-bc66acbf.patch
```

On a rebased VS Code tree, resolve any conflicts against the new upstream before applying. The patch adds `extensions/boardsession`, registers it in the extension dependency/build/packaging lists, and adds a small conditional tool-visibility gate to `languageModelToolsService.ts`. It does **not** rebuild VS Code or change the standalone `remotessh`/`wolf` repositories.

**Debug private key is intentionally NOT included in this patch or GitHub.** On an authorized development computer, supply the matching composite X.509 PEM separately at `extensions/boardsession/board-session/debug/client-identity.pem` (mode `0600`), or enter another key path using the extension's connection form. The local extension package manifest currently includes this PEM in npm/VSIX packaging as an internal default; don't distribute those built packages outside the authorized environment. The shipped native binaries target Linux x64, not Windows.
