# wolf

wolfSSH based board terminal/client prototype with two execution routes:

- **local**: VS Code / Node -> local wolfSSH -> board
- **Baton**: VS Code / Node -> OpenSSH/SSH2 -> Baton container -> wolfSSH -> board

The board-facing SSH session is always wolfSSH with X.509 authentication. The
Baton route only adds a front SSH hop that chooses where the same wolfSSH client
runs.

## Repository layout

- `include/`, `src/`, `main.c`: native boardssh wrapper and CLI
- `js/packages/board-session`: shared TypeScript/npm session implementation
- `js/vscode/board-copilot`: VS Code Copilot Agent tools
- `js/demo/windows-cli`: Windows x64 demo
- `wolfssh/`, `wolfssl/`: pinned upstream submodules
- `patches/`: local upstream compatibility patches

## Clone

```bash
git clone --recurse-submodules https://github.com/SongLei75/wolf.git
cd wolf
./build.sh
```

`build.sh` applies the repository's wolfSSH patch if the pinned upstream tree is
clean and still needs it.

Runtime X.509 credentials are deliberately not stored in Git.
