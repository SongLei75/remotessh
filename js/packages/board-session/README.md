# @songlei/board-session

Persistent terminal-session core shared by Direct, Docker, and Baton board access.

`BoardSession` owns shell readiness, command completion markers, output buffering, and lifecycle. The route only supplies the byte stream:

- `local`: spawn a local process through a PTY
- `baton`: SSH2 to Baton, allocate a PTY, and execute a remote command

Every environment that performs the final board hop must already provide working `wolfssh`/`wolfscp` commands in `PATH`, including their dynamic-library environment.

`buildWolfsshCommand()` owns the common board connection command:

```text
wolfssh -t -X -i client-identity.pem -l <user> -p <port> <host>
```

The same command is adapted by:

- `buildLocalWolfsshRoute()` -> `wolfssh ...`
- `buildDockerWolfsshRoute()` -> `docker exec -it <container> wolfssh ...`
- `buildRemoteWolfsshCommand()` -> remote `wolfssh ...` command for Baton

Minimal Direct usage:

```ts
import { BoardSession, buildLocalWolfsshRoute } from '@songlei/board-session';

const session = new BoardSession({
  route: buildLocalWolfsshRoute(
    { host: '192.168.1.100', username: 'root' },
    '/home/user/.ssh/client-identity.pem',
  ),
});

await session.start();
const result = await session.run('uname -a');
await session.close();
```
