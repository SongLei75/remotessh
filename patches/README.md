# Code - OSS BoardSession integration patch

`vscode-boardsession-bc66acbf.patch` is the complete Git **binary** patch for the BoardSession integration in Code - OSS, exported from the committed VS Code worktree (not an intermediate working-tree snapshot). It updates 250 files, including the Linux x64 native `.node`, wolfSSH/wolfSSL `.so` libraries and build headers.

- Upstream repository: `microsoft/vscode`
- Base commit: `bc66acbf854b040e1e8a92dedf385e0526145ee6`
- Integration commit: `4f2532b90b859e5856dfd8fc57e5d5df9f8615ea` (`feat(boardsession): integrate persistent board terminals with chat`)

Apply in a **clean VS Code repository at the base commit**, not in the `remotessh` repository:

```bash
cd /path/to/vscode
git apply --check /path/to/remotessh/patches/vscode-boardsession-bc66acbf.patch
git apply /path/to/remotessh/patches/vscode-boardsession-bc66acbf.patch
```

This is a full base-to-integration patch, not an incremental patch on top of an earlier BoardSession snapshot. On a different upstream revision, rebase and resolve incompatibilities before applying it. It adds `extensions/boardsession`, its standalone core npm package sources/native build assets, Chat input UI and tool switching, and focused build integration. It does **not** change the standalone `remotessh` or `wolf` implementation.

**No private PEM, generated npm archive, `node_modules` or generated `dist` is committed in the patch.** For authorized internal testing, supply the matching X.509 composite PEM separately at `extensions/boardsession/board-session/prebuilds/client-identity.pem` (mode `0600`) or enter another PEM path in the connection form. The extension build is configured to include this PEM in internally built npm/VSIX artifacts; do not publish artifacts containing private credentials. The included native binaries target Linux x64.

Validation of the integration was limited to targeted extension compilation/type checks, focused tool-service tests, packaging, and UI checks. A full VS Code build and live-board SSH acceptance test were intentionally outside this delivery's scope.
