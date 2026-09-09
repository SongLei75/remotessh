# @songlei/board-session

A persistent board terminal session with one wolfSSH board implementation and two execution routes:

- `local`: Node -> local `wolfssh` -> board
- `baton`: Node -> SSH2 -> Baton -> remote `wolfssh` -> board

The route changes only where `wolfssh` executes. Command buffering, persistent shell state, completion markers, output cursors, and lifecycle are shared by `BoardSession`.

## API

```ts
import { BoardSession, resolveBundledWolfssh } from '@songlei/board-session';

const session = new BoardSession({
  board: { host: '192.168.1.100', port: 22, username: 'root' },
  route: {
    kind: 'local',
    wolfssh: {
      executable: resolveBundledWolfssh(),
      identity: {
        certificateFile: 'client-cert.pem',
        privateKeyFile: 'client-key.pem',
        knownHostsFile: 'known_hosts',
      },
    },
  },
});

await session.start();
const result = await session.run('uname -a');
session.write('input for an interactive program\n');
const output = session.snapshot();
await session.close();
```

For Baton, provide `kind: 'baton'`, Baton host/port/user/password and the remote `wolfssh` runtime paths. The board target object is unchanged.

## Native targets

The package currently contains a statically linked `win32-x64/wolfssh.exe`. It implements direct TCP board connections with X.509 authentication and known-host verification. `ProxyCommand` is intentionally not implemented in the Windows native client; Baton routing is handled by the npm SSH2 front hop instead.
