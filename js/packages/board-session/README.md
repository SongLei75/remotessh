# @songlei/board-session

Persistent terminal-session core shared by Direct and Baton board access.

`BoardSession` owns shell readiness, command completion markers, output buffering, and lifecycle. The route only supplies the byte stream:

- `local`: spawn a local process and use its stdin/stdout
- `baton`: SSH2 to Baton, allocate a PTY, and execute a remote command

For the real product, helpers in `command.ts` build the company wolfSSH command from a composite PEM identity:

```text
wolfssh -t -X -i client-identity.pem -l <user> -p <port> <host>
```

Minimal usage:

```ts
import { BoardSession, buildLocalWolfsshRoute } from '@songlei/board-session';

const session = new BoardSession({
  route: buildLocalWolfsshRoute(
    { host: '192.168.1.100', username: 'root' },
    {
      executable: '/opt/wolfssh/bin/wolfssh',
      identityFile: '~/.ssh/client-identity.pem',
      libraryPath: '/opt/wolfssh/lib',
    },
  ),
});

await session.start();
const result = await session.run('uname -a');
await session.close();
```

Baton callers construct a `BatonRoute` with the first-hop SSH credentials and a remote command, normally produced by `buildRemoteWolfsshCommand()`.
