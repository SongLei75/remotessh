# @songlei/board-session

Persistent terminal-session core shared by Direct, Docker, and jump-server board access.

`BoardSession` owns shell readiness, command completion markers, output buffering, and lifecycle. The route only supplies the byte stream:

- `local`: spawn a local process through a PTY
- `jump`: SSH2 to a jump server, allocate a PTY, and execute a remote command

Every environment that performs the final board hop must already provide working `wolfssh`/`wolfscp` commands in `PATH`, including their dynamic-library environment.

All three builders use the same company wolfSSH command internally:

```text
wolfssh -t -X -i client-identity.pem -l <user> -p <port> <host>
```

The same command is adapted by:

- `buildLocal()` -> run the command locally
- `buildDocker()` -> run the command through `docker exec -it <container>`
- `buildRemote()` -> render the command for a jump server

Minimal Direct usage:

```ts
import { BoardSession, buildLocal } from '@songlei/board-session';

const session = new BoardSession(buildLocal(
  { host: '192.168.1.100', username: 'root' },
  '/home/user/.ssh/client-identity.pem',
));

await session.start();
const result = await session.run('uname -a');
await session.close();
```
