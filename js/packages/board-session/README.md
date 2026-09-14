# @songlei/board-session

Persistent board session shared by Direct, Docker, and jump-server access.

The public session API is intentionally small:

- `BoardSession.open(route)` — establish the board shell
- `session.exec(command)` — run a command and return output/exit code
- `session.read()` — read output produced since the previous read/exec/send
- `session.send(text)` — write interactive terminal input and collect the immediate output
- `session.close()` — close the session

Routes only describe how the final company wolfSSH command is invoked:

- `buildLocal()` — run `wolfssh` locally
- `buildDocker()` — run `wolfssh` through `docker exec -it`
- `buildRemote()` — render `wolfssh` for execution on a jump server

Every environment that performs the final board hop must already provide working `wolfssh`/`wolfscp` commands in `PATH`, including its dynamic-library environment.

All three builders use the same command internally:

```text
wolfssh -t -X -i client-identity.pem -l <user> -p <port> <host>
```

Minimal Direct usage:

```ts
import { BoardSession, buildLocal } from '@songlei/board-session';

const session = await BoardSession.open(buildLocal(
  { host: '192.168.1.100', username: 'root' },
  '/home/user/.ssh/client-identity.pem',
));

const result = await session.exec('uname -a');
await session.close();
```
