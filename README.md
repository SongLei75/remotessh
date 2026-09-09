# wolf

`wolf` 是一套面向板端开发环境的 SSH 连接方案。核心目标是：**无论用户从本地直接连接板子，还是先进入 Baton 服务器容器再连接板子，最终面向板子的 SSH 会话始终由 wolfSSH 完成，并且上层只维护一套持久 Terminal Session 逻辑。**

当前仓库包含 native C wrapper、Linux/Windows wolfSSH 客户端、统一的 TypeScript/npm `BoardSession`、VS Code Copilot Agent 工具，以及 Windows x64 单文件 demo。

## 1. 总体架构

方案只有两个独立概念：

- **Board Session**：板子侧的 SSH 会话，固定使用 wolfSSH + X.509 认证。
- **Execution Route**：wolfSSH 在哪里执行。当前支持 `local` 与 `baton` 两种 route。

### 1.1 Local 模式

```text
VS Code / Node / board-demo
        |
        | spawn
        v
     wolfssh
        |
        | SSH + X.509
        v
      Board
```

如果本地环境不能直接访问板子，Linux native client 还支持 `ProxyCommand`，例如通过 `gcloud start-iap-tunnel` 提供底层字节流：

```text
VS Code / Node
      |
   wolfssh
      |
 ProxyCommand
      |
 gcloud IAP
      |
    Board
```

`ProxyCommand` 只改变 wolfSSH 的底层传输，SSH 握手、X.509 用户认证、host key 校验、shell、exec、SCP 仍然全部由 wolfSSH 完成。

### 1.2 Baton 模式

公司 Baton 平台对外暴露的是一个服务器上的容器，例如：

```bash
ssh root@baton.example -p 12345
```

容器内部可以访问板子，并允许部署 wolfSSH 客户端及其动态库，但不假设可以部署 Node 服务、daemon 或额外运行时。

因此 Baton 模式为：

```text
VS Code / Node / board-demo
        |
        | SSH2 / OpenSSH front hop
        v
  Baton container
        |
        | exec wolfssh
        v
      wolfssh
        |
        | SSH + X.509
        v
      Board
```

Local 与 Baton **不是两套 Board backend**。它们共享同一个 `BoardSession`；唯一差异是 wolfSSH 进程前面是否多了一跳到 Baton 的 SSH 连接。

TypeScript 层的抽象是：

```text
                  BoardSession
                       |
                ExecutionRoute
                /             \
             local            baton
               |                |
            wolfssh           SSH2
               |                |
               |             Baton
               |                |
               +----------> wolfssh
                                |
                              Board
```

## 2. 当前测试拓扑

当前开发环境使用 GCP 模拟板子、OCI E1 模拟 Baton/服务器执行环境。

### T1: Local / Proxy

```text
开发机
  |
  | wolfSSH
  v
gcloud IAP TCP tunnel
  |
  v
GCP private IP:2222
  |
  v
PKIX-SSHD
```

实际验证过：

```text
Node BoardSession
  -> local wolfssh
  -> gcloud IAP
  -> GCP PKIX-SSHD
```

### T2: Baton / Direct

```text
开发机
  |
  | SSH2
  v
OCI E1
  |
  | wolfSSH / IPv6
  v
GCP public IPv6:2222
  |
  v
PKIX-SSHD
```

实际验证过：

```text
Node BoardSession
  -> SSH2
  -> OCI E1
  -> remote wolfssh
  -> GCP PKIX-SSHD
```

两条链路都已验证持久 shell、命令执行、exit code 和 session cleanup。

## 3. 仓库结构

```text
wolf/
├── CMakeLists.txt
├── build.sh
├── main.c
├── main_windows.c
├── include/
│   ├── boardssh.h
│   └── ssh_config.h
├── src/
│   ├── boardssh.c
│   └── ssh_config.c
├── patches/
│   └── wolfssh-rfc6187-ecdsa-signature-name.patch
├── scripts/
│   ├── build-windows-native.sh
│   └── build-windows-demo.sh
├── js/
│   ├── package.json
│   ├── packages/
│   │   └── board-session/
│   ├── vscode/
│   │   └── board-copilot/
│   └── demo/
│       └── windows-cli/
├── wolfssh/                 # upstream submodule
└── wolfssl/                 # upstream submodule
```

`wolfssh/` 与 `wolfssl/` 都是固定 commit 的上游 submodule。本项目对 wolfSSH 的 RFC 6187 互操作修改保存在顶层 `patches/`，不直接提交进上游 submodule。

## 4. Native 层职责

`libboardssh` 负责：

- wolfSSH 初始化与 session 生命周期；
- X.509 client certificate + private key 用户认证；
- `known_hosts` host key 校验；
- interactive shell；
- remote exec；
- SCP put/get；
- Linux `ProxyCommand` byte stream；
- machine mode readiness marker。

Native 层不知道 VS Code、Copilot、Baton 或 Agent tool。Baton 只存在于 TypeScript route 层。

### 4.1 RFC 6187 patch

`patches/wolfssh-rfc6187-ecdsa-signature-name.patch` 修正 X.509 ECDSA 用户认证中的 signature blob algorithm name：

- public key algorithm 仍使用 `x509v3-ecdsa-sha2-*`；
- signature blob 使用对应 RFC 5656 `ecdsa-sha2-*` 名称。

这是与 PKIX-SSH / OpenSSH X.509 实现互操作所需的差异。

`build.sh` 会在构建时临时应用 patch；如果 patch 是构建脚本自己应用的，退出时会自动恢复 submodule 工作树。

## 5. Clone

推荐直接带 submodule clone：

```bash
git clone --recurse-submodules git@github.com:SongLei75/wolf.git
cd wolf
```

如果已经普通 clone：

```bash
git submodule update --init --recursive
```

## 6. Linux native 构建

### 6.1 依赖

Ubuntu/Debian 建议准备：

```bash
sudo apt install \
  build-essential \
  autoconf automake libtool pkg-config \
  cmake git
```

本项目不会自动安装这些系统依赖。

### 6.2 构建

```bash
./build.sh
```

可通过 `JOBS` 控制并行数：

```bash
JOBS=8 ./build.sh
```

输出：

```text
build/bin/wolfssh
build/bin/wolfscp
build/lib/libboardssh.so
build/lib/libwolfssh.so*
build/lib/libwolfssl.so*
```

Linux 可执行文件使用相对 RPATH：

```text
wolfssh / wolfscp -> $ORIGIN/../lib
libboardssh.so    -> $ORIGIN
```

所以 `build/bin + build/lib` 可以整体复制到服务器/Baton，不依赖源码目录的绝对路径。

## 7. Native CLI 使用

### 7.1 直接连接板子

```bash
build/bin/wolfssh \
  -N \
  -h 192.168.1.100 \
  -p 22 \
  -u root \
  -c /path/client-cert.pem \
  -i /path/client-key.pem \
  -K /path/known_hosts
```

如果 `known_hosts` 使用固定别名：

```bash
build/bin/wolfssh \
  -N \
  -h 192.168.1.100 \
  -p 22 \
  -u root \
  -c /path/client-cert.pem \
  -i /path/client-key.pem \
  -K /path/known_hosts \
  -A board-a
```

执行单条命令：

```bash
build/bin/wolfssh \
  -N -h 192.168.1.100 -p 22 -u root \
  -c /path/client-cert.pem \
  -i /path/client-key.pem \
  -K /path/known_hosts \
  -- uname -a
```

### 7.2 ssh_config profile

Linux CLI 支持当前项目需要的 OpenSSH client config 子集：

```text
Host
HostName
Port
User
IdentityFile
CertificateFile
UserKnownHostsFile
HostKeyAlias
ProxyCommand
```

示例：

```ssh
Host board-gcp
    HostName 10.0.0.10
    Port 2222
    User root
    IdentityFile ~/.ssh/board/client-key.pem
    CertificateFile ~/.ssh/board/client-cert.pem
    UserKnownHostsFile ~/.ssh/board/known_hosts
    HostKeyAlias board-gcp
    ProxyCommand gcloud compute start-iap-tunnel board-vm 2222 --listen-on-stdin --project=PROJECT --zone=ZONE
```

连接：

```bash
build/bin/wolfssh board-gcp
```

检查解析结果：

```bash
build/bin/wolfssh -G board-gcp
```

### 7.3 CLI 参数

```text
-F FILE       OpenSSH-style client config
-N            不读取 ssh_config，参数完全由 CLI 提供
-M            machine mode；登录成功后在 stderr 输出内部 ready marker
-G            打印解析后的配置
-h HOST       HostName / direct host
-p PORT       board port
-u USER       board user
-c CERT       X.509 CertificateFile
-i KEY        IdentityFile
-K FILE       UserKnownHostsFile
-A ALIAS      HostKeyAlias
-P COMMAND    ProxyCommand（Linux）
```

`-M` 主要给 npm/VS Code 使用。`BoardSession.start()` 会等待这个 marker，只有 wolfSSH 完成认证并拿到 board shell 后才认为 session ready。

## 8. 凭据和 known_hosts

运行时身份材料不提交到 Git。

`config/gcpp/` 是本机 GCP 测试环境目录，除 README 外全部被 `.gitignore` 排除。

生产环境至少需要：

```text
client-cert.pem
client-key.pem
known_hosts
```

建议权限：

```bash
chmod 600 client-key.pem
chmod 644 client-cert.pem known_hosts
```

当前 native `known_hosts` parser 按明文 host/alias 精确匹配，不应依赖 OpenSSH hashed-host entry。非 22 端口且没有 `HostKeyAlias` 时，目标格式为：

```text
[host]:port
```

## 9. Baton 部署

Baton 容器不需要 Node/npm，也不需要运行额外 daemon。

最小部署目录建议固定为：

```text
/opt/boardssh/
├── bin/
│   └── wolfssh
├── lib/
│   ├── libboardssh.so
│   ├── libwolfssh.so*
│   └── libwolfssl.so*
└── config/
    ├── client-cert.pem
    ├── client-key.pem
    └── known_hosts
```

从 Linux build 产物准备目录：

```bash
mkdir -p package/opt/boardssh/{bin,lib,config}
cp build/bin/wolfssh package/opt/boardssh/bin/
cp -a build/lib/libboardssh.so build/lib/libwolfssh.so* build/lib/libwolfssl.so* \
  package/opt/boardssh/lib/
```

再通过公司的 Baton 镜像/部署流程放入容器，并加入该容器自己的证书和 `known_hosts`。

Baton 上可直接验证：

```bash
/opt/boardssh/bin/wolfssh \
  -N \
  -h BOARD_IP \
  -p 22 \
  -u root \
  -c /opt/boardssh/config/client-cert.pem \
  -i /opt/boardssh/config/client-key.pem \
  -K /opt/boardssh/config/known_hosts
```

这里仍然是 wolfSSH 直接连接板子；Baton 前置 SSH 只由 PC/VS Code 侧负责。

## 10. JavaScript / npm workspace

### 10.1 依赖安装

当前开发基线推荐 Node.js 24 + npm 11。

```bash
cd js
npm ci --include=dev
```

如果宿主环境设置了 `NODE_ENV=production`，必须显式保留 dev dependencies，否则 TypeScript/esbuild/vsce 会被 npm 省略。

### 10.2 构建全部 JS 组件

```bash
npm run build
```

当前 workspace 会依次构建：

```text
@songlei/board-session
board-copilot
board-windows-demo
```

运行 npm 单测：

```bash
npm test
```

## 11. `@songlei/board-session`

目录：

```text
js/packages/board-session
```

它是 Local 与 Baton 共用的核心 TypeScript API。

### 11.1 Local 示例

```ts
import {
  BoardSession,
  resolveBundledWolfssh,
} from '@songlei/board-session';

const session = new BoardSession({
  board: {
    host: '192.168.1.100',
    port: 22,
    username: 'root',
  },
  route: {
    kind: 'local',
    wolfssh: {
      executable: process.platform === 'win32'
        ? resolveBundledWolfssh()
        : '/opt/boardssh/bin/wolfssh',
      identity: {
        certificateFile: '/path/client-cert.pem',
        privateKeyFile: '/path/client-key.pem',
        knownHostsFile: '/path/known_hosts',
        hostKeyAlias: 'board-a',
      },
    },
  },
});

await session.start();

const result = await session.run('uname -a');
console.log(result.text);
console.log(result.exitCode);

session.write('input for interactive program\n');
console.log(session.snapshot());

await session.close();
```

### 11.2 Baton 示例

```ts
import { BoardSession } from '@songlei/board-session';

const session = new BoardSession({
  board: {
    host: '10.1.2.3',
    port: 22,
    username: 'root',
  },
  route: {
    kind: 'baton',
    host: 'baton.example.com',
    port: 12345,
    username: 'root',
    password: process.env.BOARD_BATON_PASSWORD,
    hostFingerprintSha256: 'SHA256:...',
    wolfssh: {
      executable: '/opt/boardssh/bin/wolfssh',
      identity: {
        certificateFile: '/opt/boardssh/config/client-cert.pem',
        privateKeyFile: '/opt/boardssh/config/client-key.pem',
        knownHostsFile: '/opt/boardssh/config/known_hosts',
      },
    },
  },
});

await session.start();
const result = await session.run('hostname && id');
console.log(result);
await session.close();
```

Baton 前置认证 API 支持：

```text
password
privateKey
SSH agent
```

VS Code 插件的生产使用路径只要求用户输入 Baton password，并由 VS Code SecretStorage 保存。

建议生产环境同时设置 `hostFingerprintSha256`，否则前置 Baton SSH 不具备固定 host key pinning。

### 11.3 持久 shell 行为

`BoardSession` 不是每个命令重新连接一次 SSH。

下面三条调用处于同一板端 shell：

```ts
await session.run('cd /tmp');
await session.run('export TEST_VALUE=123');
await session.run('pwd; echo "$TEST_VALUE"');
```

`run()` 会在现有 shell 内追加随机 completion marker，并读取真实 `$?`。如果命令超过 timeout，session 不会被自动销毁，可以继续使用 `snapshot()` / `write()` 获取后续输出或与交互程序通信。

默认保留最近约 2,000,000 个字符，输出通过绝对 offset 读取。

### 11.4 打包 npm tarball

```bash
cd js
npm run build -w @songlei/board-session
npm pack -w @songlei/board-session
```

Win64 native client 已作为 package asset 包含：

```text
native/win32-x64/wolfssh.exe
```

Windows x64 可使用：

```ts
resolveBundledWolfssh()
```

## 12. Windows x64 native wolfSSH

仓库中已经包含构建好的：

```text
js/packages/board-session/native/win32-x64/wolfssh.exe
```

它是 PE32+ x86-64 console executable，wolfSSL、wolfSSH、boardssh 和 winpthreads 均静态链接；仅依赖 Windows 系统 DLL，例如 UCRT、`WS2_32`、`CRYPT32`。

Windows native client 当前支持 **direct TCP board connection**。Linux `ProxyCommand` 没有移植到 Windows native client，因为 Baton front hop 已由 npm 的 SSH2 route 实现，没有必要把第二套进程代理机制塞进 Windows C 层。

### 12.1 从 Ubuntu 重新交叉构建 Win64 native client

```bash
./scripts/build-windows-native.sh
```

脚本会：

1. 使用 pinned wolfSSH/wolfSSL submodule commit 建临时 Git worktree；
2. 在临时 wolfSSH worktree 应用 RFC 6187 patch；
3. 下载/使用 llvm-mingw `20260826` UCRT x86_64 toolchain；
4. 静态构建 wolfSSL + wolfSSH；
5. 交叉构建 `main_windows.c + libboardssh`；
6. 覆盖 npm package 内：

```text
js/packages/board-session/native/win32-x64/wolfssh.exe
```

默认如果 toolchain 是本次脚本下载的，结束后会删除。需要保留：

```bash
KEEP_TOOLCHAIN=1 ./scripts/build-windows-native.sh
```

## 13. Windows x64 单文件 demo

源码：

```text
js/demo/windows-cli
```

先构建 JS bundle：

```bash
cd js
npm run build -w board-windows-demo
```

生成单文件 Win64 SEA：

```bash
cd ..
./scripts/build-windows-demo.sh
```

输出：

```text
js/demo/windows-cli/dist/board-demo.exe
```

该 EXE 包含：

- Node.js Windows x64 runtime；
- bundled JS `BoardSession`；
- SSH2 Baton front hop；
- Win64 `wolfssh.exe` SEA asset。

Local 模式启动时会把内嵌 wolfSSH 临时提取到 `%TEMP%/board-wolfssh-*`，session 结束时删除。Baton 模式不需要本地提取 wolfSSH，因为真正的 wolfSSH 在 Baton 容器内执行。

### 13.1 Windows demo Local

```powershell
.\board-demo.exe local `
  --board-host 192.168.1.100 `
  --board-port 22 `
  --board-user root `
  --cert C:\board\client-cert.pem `
  --key C:\board\client-key.pem `
  --known-hosts C:\board\known_hosts
```

### 13.2 Windows demo Baton

```powershell
$env:BOARD_BATON_PASSWORD = '...'

.\board-demo.exe baton `
  --board-host 10.1.2.3 `
  --board-user root `
  --baton-host baton.example.com `
  --baton-port 12345 `
  --baton-user root `
  --baton-host-fingerprint 'SHA256:...'
```

如果没有 `BOARD_BATON_PASSWORD`，demo 会在 TTY 中 masked prompt 输入密码。

默认 Baton 内部路径：

```text
/opt/boardssh/bin/wolfssh
/opt/boardssh/config/client-cert.pem
/opt/boardssh/config/client-key.pem
/opt/boardssh/config/known_hosts
```

可用：

```text
--remote-wolfssh
--remote-cert
--remote-key
--remote-known-hosts
--remote-host-key-alias
```

覆盖。

连接成功后就是持续交互的 board shell。`Ctrl+C` 作为输入转发到板子；`Ctrl+]` 由 demo 自己解释为断开 session。

## 14. VS Code Board Copilot 插件

目录：

```text
js/vscode/board-copilot
```

目标是让蓝标 VS Code 的 Copilot Agent/协作者模式获得一组专用板端 terminal tools。

### 14.1 构建 VSIX

```bash
cd js
npm ci --include=dev
npm run package -w board-copilot
```

输出：

```text
js/vscode/board-copilot/dist/board-copilot.vsix
```

从仓库根目录安装：

```bash
cd ..
code --install-extension \
  js/vscode/board-copilot/dist/board-copilot.vsix
```

当前 extension engine：

```text
VS Code >= 1.136
```

### 14.2 Copilot tools

插件注册 5 个 Language Model Tools：

```text
#boardOpen
#boardRun
#boardOutput
#boardSend
#boardKill
```

对应：

```text
board-copilot_openSession
board-copilot_runInTerminal
board-copilot_getTerminalOutput
board-copilot_sendToTerminal
board-copilot_killTerminal
```

典型 Agent 流程：

```text
用户要求连接板子
      |
      v
Copilot 判断缺少 route / board 参数
      |
      v
在 Chat 中询问：
  local / baton
  board host / port / user
  Baton 模式额外询问 Baton host / port / user
      |
      v
#boardOpen
      |
      v
如果 Baton password 未保存：
VS Code masked input -> SecretStorage
      |
      v
persistent BoardSession ready
      |
      v
后续 Agent 使用：
#boardRun / #boardOutput / #boardSend / #boardKill
```

Baton password **不会作为 tool 参数进入 Chat/model context**。

### 14.3 Local VS Code settings

最常见 direct local 配置：

```json
{
  "boardCopilot.local.wolfsshPath": "/home/user/project/wolf/build/bin/wolfssh",
  "boardCopilot.local.certificateFile": "/home/user/.ssh/board/client-cert.pem",
  "boardCopilot.local.privateKeyFile": "/home/user/.ssh/board/client-key.pem",
  "boardCopilot.local.knownHostsFile": "/home/user/.ssh/board/known_hosts",
  "boardCopilot.local.hostKeyAlias": "board-a"
}
```

Linux 也可配置：

```json
{
  "boardCopilot.local.proxyCommand": "gcloud compute start-iap-tunnel ... --listen-on-stdin"
}
```

或者使用 profile：

```json
{
  "boardCopilot.local.wolfsshPath": "/home/user/project/wolf/build/bin/wolfssh",
  "boardCopilot.local.configFile": "/home/user/.ssh/config",
  "boardCopilot.local.destination": "board-gcp"
}
```

`configFile` 与 `destination` 必须同时设置。

### 14.4 Baton VS Code settings

推荐生产布局：

```json
{
  "boardCopilot.baton.remoteWolfsshPath": "/opt/boardssh/bin/wolfssh",
  "boardCopilot.baton.remoteCertificateFile": "/opt/boardssh/config/client-cert.pem",
  "boardCopilot.baton.remotePrivateKeyFile": "/opt/boardssh/config/client-key.pem",
  "boardCopilot.baton.remoteKnownHostsFile": "/opt/boardssh/config/known_hosts",
  "boardCopilot.baton.hostFingerprintSha256": "SHA256:..."
}
```

Baton host、port、user 不需要写死在 settings；Copilot 可在用户发起连接时通过 Chat 收集。

第一次连接某个 `user@host:port` 时，插件弹出 masked password 输入框，并写入 VS Code `SecretStorage`。

可执行命令：

```text
Board Copilot: Clear Saved Baton Passwords
```

清除本次 extension runtime 已记录的 Baton password secret。

### 14.5 Agent 工具路由限制

普通 VS Code extension 可以注册 Language Model Tools，但不能拦截或替换 Copilot 内置 terminal tool。

如果需要严格保证“对板子的所有终端动作都经过 wolfSSH”，蓝标插件使用时应在 Copilot Tools 配置中关闭不需要的内置 terminal tool，并保留 Board Copilot tools。

未来橙标 Code - OSS 源码方案可以从内部直接把原生 `run_in_terminal` backend 切换到同一套 `BoardSession`，不受这个扩展 API 边界限制。

## 15. 安全边界

本仓库遵循以下原则：

- 不提交生产/测试私钥；
- 不把 Baton password 放入 prompt 或 tool 参数；
- Board host key 必须通过 `known_hosts` 校验；
- Baton 建议配置 SHA256 host key fingerprint pinning；
- Baton 容器不要求 Node daemon 或常驻 helper；
- Linux `ProxyCommand` 仅作为底层 byte stream，不改变 board-facing SSH implementation；
- Windows local route 只支持 direct TCP，不提供隐藏的 OpenSSH fallback；
- session close 会清理本地 child process / SSH2 channel / remote wolfSSH process。

## 16. 开发与验证

### Native Linux

```bash
./build.sh
build/bin/wolfssh -G <profile>
```

### TypeScript/npm

```bash
cd js
npm ci --include=dev
npm run build
npm test
```

### VSIX

```bash
cd js
npm run package -w board-copilot
```

### Win64 native

```bash
./scripts/build-windows-native.sh
```

### Win64 single-file demo

```bash
./scripts/build-windows-demo.sh
```

### Git cleanliness

构建输出都在 `.gitignore` 范围内。正常构建完成后：

```bash
git status --short
```

不应出现构建工具链、`node_modules`、`dist`、证书或私钥等新增 tracked 文件。

## 17. 当前状态与限制

已经在当前开发环境实际完成：

```text
[OK] Linux wolfSSH native build
[OK] X.509 login to PKIX-SSHD
[OK] Linux ProxyCommand / gcloud IAP route
[OK] Local BoardSession E2E
[OK] Baton/OCI BoardSession E2E
[OK] persistent shell + command exit status
[OK] Baton remote wolfSSH cleanup
[OK] npm package build/tests
[OK] VS Code extension build / VSIX packaging
[OK] Win64 wolfssh.exe cross build
[OK] Win64 Node SEA board-demo.exe generation
```

仍需要在真实目标环境完成的最终验收：

```text
[TODO] Windows x64 实机运行 board-demo.exe 并连接真实/测试板子
[TODO] 蓝标 VS Code Copilot Chat UI 真实 Agent E2E
[TODO] 公司 Baton 实际容器网络、权限、镜像部署 E2E
[TODO] 橙标 Code - OSS 原生 terminal backend 集成
```

Windows native/SEA 当前已完成交叉构建和 PE 产物校验，但仓库不能替代 Windows 目标机上的最终运行测试。

## 18. 设计原则总结

本方案刻意保持一个边界：

```text
是否经过 Baton，只决定 wolfSSH 在哪里运行；
真正连接板子的 SSH session 始终是同一套 wolfSSH 实现。
```

因此 Local 与 Baton 共享：

```text
Board target
X.509 identity
known_hosts verification
persistent shell
stdin/stdout
command completion
exit status
output cursor
session lifecycle
Agent terminal semantics
```

前置 Baton SSH 不进入 native boardssh core，也不复制第二套 terminal 逻辑。这样 VS Code 插件、npm API、Windows demo，以及未来 Code - OSS terminal backend 都可以复用同一个 `BoardSession`。
