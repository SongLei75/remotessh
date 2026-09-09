#ifndef _WIN32
#define _POSIX_C_SOURCE 200809L
#endif

#include "boardssh.h"

#include <errno.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdint.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <io.h>
#ifndef STDIN_FILENO
#define STDIN_FILENO 0
#define STDOUT_FILENO 1
#define STDERR_FILENO 2
#endif
#else
#include <netdb.h>
#include <signal.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>
#endif

#include <wolfssl/options.h>
#include <wolfssl/wolfcrypt/coding.h>
#include <wolfssl/wolfcrypt/memory.h>
#include <wolfssh/ssh.h>
#include <wolfssh/wolfscp.h>

typedef struct {
    byte *certificate;
    word32 certificate_sz;
    const byte *certificate_type;
    word32 certificate_type_sz;
    byte *private_key;
    word32 private_key_sz;
    const byte *private_key_type;
    word32 private_key_type_sz;
} boardssh_identity_t;

#ifdef _WIN32
typedef intptr_t boardssh_proxy_pid_t;
#define BOARDSSH_INVALID_SOCKET INVALID_SOCKET
#else
typedef pid_t boardssh_proxy_pid_t;
#define BOARDSSH_INVALID_SOCKET (-1)
#endif

typedef struct {
    WOLFSSH_CTX *ctx;
    WOLFSSH *ssh;
    WS_SOCKET_T fd;
    boardssh_proxy_pid_t proxy_pid;
    boardssh_identity_t identity;
    const boardssh_config_t *config;
} boardssh_session_t;

static void set_error(boardssh_error_t *error, int code, int wolfssh_code,
                      int sys_errno, const char *fmt, ...)
{
    va_list ap;

    if (error == NULL)
        return;

    memset(error, 0, sizeof(*error));
    error->code = code;
    error->wolfssh_code = wolfssh_code;
    error->sys_errno = sys_errno;

    va_start(ap, fmt);
    vsnprintf(error->message, sizeof(error->message), fmt, ap);
    va_end(ap);
}

static void identity_free(boardssh_identity_t *identity)
{
    if (identity == NULL)
        return;

    if (identity->certificate != NULL) {
        wolfSSL_Free(identity->certificate);
        identity->certificate = NULL;
    }
    if (identity->private_key != NULL) {
        memset(identity->private_key, 0, identity->private_key_sz);
        wolfSSL_Free(identity->private_key);
        identity->private_key = NULL;
    }
}

static int identity_load(const boardssh_config_t *config,
                         boardssh_identity_t *identity,
                         boardssh_error_t *error)
{
    byte flavor = WOLFSSH_CERT_FLAVOR_UNKNOWN;
    byte is_private = 0;
    int ret;

    memset(identity, 0, sizeof(*identity));

    ret = wolfSSH_ReadCert_file(config->cert_file,
            &identity->certificate, &identity->certificate_sz,
            &identity->certificate_type, &identity->certificate_type_sz,
            &flavor, NULL);
    if (ret != WS_SUCCESS || flavor != WOLFSSH_CERT_FLAVOR_X509) {
        set_error(error, BOARDSSH_EAUTH, ret, 0,
                  "failed to load X.509 certificate: %s", config->cert_file);
        identity_free(identity);
        return BOARDSSH_EAUTH;
    }

    ret = wolfSSH_ReadKey_file(config->private_key_file,
            &identity->private_key, &identity->private_key_sz,
            &identity->private_key_type, &identity->private_key_type_sz,
            &is_private, NULL);
    if (ret != WS_SUCCESS || !is_private) {
        set_error(error, BOARDSSH_EAUTH, ret, 0,
                  "failed to load private key: %s", config->private_key_file);
        identity_free(identity);
        return BOARDSSH_EAUTH;
    }

    return BOARDSSH_OK;
}

static int user_auth_cb(byte auth_type, WS_UserAuthData *auth_data, void *ctx)
{
    boardssh_identity_t *identity = (boardssh_identity_t *)ctx;
    WS_UserAuthData_PublicKey *pk;

    if (auth_type != WOLFSSH_USERAUTH_PUBLICKEY || identity == NULL)
        return WOLFSSH_USERAUTH_FAILURE;

    pk = &auth_data->sf.publicKey;
    pk->publicKeyType = identity->certificate_type;
    pk->publicKeyTypeSz = identity->certificate_type_sz;
    pk->publicKey = identity->certificate;
    pk->publicKeySz = identity->certificate_sz;
    pk->privateKey = identity->private_key;
    pk->privateKeySz = identity->private_key_sz;

    return WOLFSSH_USERAUTH_SUCCESS;
}

#ifdef _WIN32
#define boardssh_strtok_r(str, delim, save) strtok_s((str), (delim), (save))
#else
#define boardssh_strtok_r(str, delim, save) strtok_r((str), (delim), (save))
#endif

static int host_key_check_cb(const byte *public_key, word32 public_key_sz,
                             void *ctx)
{
    const boardssh_config_t *config = (const boardssh_config_t *)ctx;
    FILE *fp = NULL;
    char line[8192];
    char target[512];
    char key_type[128];
    char *encoded = NULL;
    word32 key_type_sz;
    word32 encoded_sz;
    int found = 0;
    int ret = 1;

    if (config == NULL)
        return 1;
    if (config->known_hosts_file == NULL || public_key == NULL ||
        public_key_sz < 4) {
        return 1;
    }

    key_type_sz = ((word32)public_key[0] << 24) |
                  ((word32)public_key[1] << 16) |
                  ((word32)public_key[2] << 8) |
                  (word32)public_key[3];
    if (key_type_sz == 0 || key_type_sz >= sizeof(key_type) ||
        key_type_sz > public_key_sz - 4) {
        return 1;
    }
    memcpy(key_type, public_key + 4, key_type_sz);
    key_type[key_type_sz] = '\0';

    encoded_sz = ((public_key_sz + 2U) / 3U) * 4U + 1U;
    encoded = malloc(encoded_sz);
    if (encoded == NULL)
        return 1;
    --encoded_sz;
    if (Base64_Encode_NoNl(public_key, public_key_sz,
                           (byte *)encoded, &encoded_sz) != 0) {
        free(encoded);
        return 1;
    }
    encoded[encoded_sz] = '\0';

    if (config->host_key_alias != NULL && config->host_key_alias[0] != '\0') {
        snprintf(target, sizeof(target), "%s", config->host_key_alias);
    }
    else if (config->port == 22) {
        snprintf(target, sizeof(target), "%s", config->host);
    }
    else {
        snprintf(target, sizeof(target), "[%s]:%u", config->host,
                 (unsigned)config->port);
    }

    fp = fopen(config->known_hosts_file, "r");
    if (fp == NULL) {
        free(encoded);
        return 1;
    }

    while (fgets(line, sizeof(line), fp) != NULL) {
        char *save = NULL;
        char *names;
        char *type;
        char *key;
        char *name_save = NULL;
        char *name;
        int name_match = 0;

        names = boardssh_strtok_r(line, " \t\r\n", &save);
        if (names == NULL || names[0] == '#')
            continue;
        if (names[0] == '@') {
            names = boardssh_strtok_r(NULL, " \t\r\n", &save);
            if (names == NULL)
                continue;
        }
        type = boardssh_strtok_r(NULL, " \t\r\n", &save);
        key = boardssh_strtok_r(NULL, " \t\r\n", &save);
        if (type == NULL || key == NULL)
            continue;

        for (name = boardssh_strtok_r(names, ",", &name_save);
             name != NULL;
             name = boardssh_strtok_r(NULL, ",", &name_save)) {
            if (strcmp(name, target) == 0) {
                name_match = 1;
                break;
            }
        }
        if (!name_match)
            continue;

        found = 1;
        if (strcmp(type, key_type) == 0 && strcmp(key, encoded) == 0) {
            ret = 0;
            break;
        }
    }

    fclose(fp);
    free(encoded);

    return found ? ret : 1;
}

static int boardssh_socket_error(void)
{
#ifdef _WIN32
    return WSAGetLastError();
#else
    return errno;
#endif
}

static void boardssh_socket_close(WS_SOCKET_T fd)
{
#ifdef _WIN32
    if (fd != INVALID_SOCKET)
        closesocket(fd);
#else
    if (fd >= 0)
        close(fd);
#endif
}

static WS_SOCKET_T tcp_connect(const char *host, uint16_t port,
                               boardssh_error_t *error)
{
    struct addrinfo hints;
    struct addrinfo *result = NULL;
    struct addrinfo *rp;
    char service[16];
    WS_SOCKET_T fd = BOARDSSH_INVALID_SOCKET;
    int gai_ret;
    int saved_error = 0;

#ifdef _WIN32
    {
        static int winsock_started = 0;
        if (!winsock_started) {
            WSADATA data;
            int wsa = WSAStartup(MAKEWORD(2, 2), &data);
            if (wsa != 0) {
                set_error(error, BOARDSSH_EIO, 0, wsa,
                          "WSAStartup failed: %d", wsa);
                return BOARDSSH_INVALID_SOCKET;
            }
            winsock_started = 1;
        }
    }
#endif

    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    snprintf(service, sizeof(service), "%u", (unsigned)port);

    gai_ret = getaddrinfo(host, service, &hints, &result);
    if (gai_ret != 0) {
        set_error(error, BOARDSSH_EIO, 0, gai_ret,
                  "getaddrinfo(%s:%s) failed: %d", host, service, gai_ret);
        return BOARDSSH_INVALID_SOCKET;
    }

    for (rp = result; rp != NULL; rp = rp->ai_next) {
        fd = socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
        if (fd == BOARDSSH_INVALID_SOCKET) {
            saved_error = boardssh_socket_error();
            continue;
        }
        if (connect(fd, rp->ai_addr, (int)rp->ai_addrlen) == 0)
            break;
        saved_error = boardssh_socket_error();
        boardssh_socket_close(fd);
        fd = BOARDSSH_INVALID_SOCKET;
    }

    freeaddrinfo(result);

    if (fd == BOARDSSH_INVALID_SOCKET) {
        set_error(error, BOARDSSH_EIO, 0, saved_error,
                  "connect(%s:%u) failed (socket error %d)", host,
                  (unsigned)port, saved_error);
    }
    return fd;
}

static WS_SOCKET_T proxy_start(const char *command, boardssh_proxy_pid_t *pid_out,
                       boardssh_error_t *error)
{
#ifdef _WIN32
    (void)command;
    if (pid_out != NULL) *pid_out = -1;
    set_error(error, BOARDSSH_EIO, 0, 0,
              "ProxyCommand is not supported by the Windows native client");
    return BOARDSSH_INVALID_SOCKET;
#else
    int sockets[2] = {-1, -1};
    pid_t pid;

    if (command == NULL || command[0] == '\0' || pid_out == NULL) {
        set_error(error, BOARDSSH_EINVAL, 0, 0, "invalid ProxyCommand");
        return -1;
    }

    if (socketpair(AF_UNIX, SOCK_STREAM, 0, sockets) != 0) {
        set_error(error, BOARDSSH_EIO, 0, errno,
                  "socketpair for ProxyCommand failed: %s", strerror(errno));
        return -1;
    }

    pid = fork();
    if (pid < 0) {
        int saved_errno = errno;
        close(sockets[0]);
        close(sockets[1]);
        set_error(error, BOARDSSH_EIO, 0, saved_errno,
                  "fork for ProxyCommand failed: %s", strerror(saved_errno));
        return -1;
    }

    if (pid == 0) {
        (void)setpgid(0, 0);
        close(sockets[0]);
        if (dup2(sockets[1], STDIN_FILENO) < 0 ||
            dup2(sockets[1], STDOUT_FILENO) < 0) {
            _exit(126);
        }
        if (sockets[1] > STDERR_FILENO)
            close(sockets[1]);
        execl("/bin/sh", "sh", "-c", command, (char *)NULL);
        _exit(127);
    }

    close(sockets[1]);
    (void)setpgid(pid, pid);
    *pid_out = pid;
    return sockets[0];
#endif
}

static void proxy_stop(boardssh_proxy_pid_t pid)
{
#ifdef _WIN32
    (void)pid;
#else
    int status;
    pid_t waited;
    struct timespec pause = {0, 50000000L};
    int i;

    if (pid <= 0)
        return;

    for (i = 0; i < 10; ++i) {
        waited = waitpid(pid, &status, WNOHANG);
        if (waited == pid || (waited < 0 && errno == ECHILD))
            return;
        (void)nanosleep(&pause, NULL);
    }

    (void)kill(-pid, SIGTERM);
    for (i = 0; i < 10; ++i) {
        waited = waitpid(pid, &status, WNOHANG);
        if (waited == pid || (waited < 0 && errno == ECHILD))
            return;
        (void)nanosleep(&pause, NULL);
    }

    (void)kill(-pid, SIGKILL);
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
    }
#endif
}

static void session_close(boardssh_session_t *session)
{
    if (session == NULL)
        return;

    if (session->ssh != NULL) {
        (void)wolfSSH_shutdown(session->ssh);
        wolfSSH_free(session->ssh);
        session->ssh = NULL;
    }
    if (session->ctx != NULL) {
        wolfSSH_CTX_free(session->ctx);
        session->ctx = NULL;
    }
    if (session->fd != BOARDSSH_INVALID_SOCKET) {
        boardssh_socket_close(session->fd);
        session->fd = BOARDSSH_INVALID_SOCKET;
    }
    if (session->proxy_pid > 0) {
        proxy_stop(session->proxy_pid);
        session->proxy_pid = -1;
    }
    identity_free(&session->identity);
}

static int validate_config(const boardssh_config_t *config,
                           boardssh_error_t *error)
{
    if (config == NULL || config->host == NULL || config->host[0] == '\0' ||
            config->port == 0 || config->username == NULL ||
            config->username[0] == '\0' || config->cert_file == NULL ||
            config->private_key_file == NULL ||
            config->known_hosts_file == NULL) {
        set_error(error, BOARDSSH_EINVAL, 0, 0, "invalid boardssh config");
        return BOARDSSH_EINVAL;
    }
    return BOARDSSH_OK;
}

static int session_prepare(const boardssh_config_t *config,
                           boardssh_session_t *session,
                           boardssh_error_t *error)
{
    int ret;

    memset(session, 0, sizeof(*session));
    session->fd = BOARDSSH_INVALID_SOCKET;
    session->proxy_pid = -1;
    session->config = config;

    ret = validate_config(config, error);
    if (ret != BOARDSSH_OK)
        return ret;

    ret = wolfSSH_Init();
    if (ret != WS_SUCCESS) {
        set_error(error, BOARDSSH_ESSH, ret, 0, "wolfSSH_Init failed");
        return BOARDSSH_ESSH;
    }

    ret = identity_load(config, &session->identity, error);
    if (ret != BOARDSSH_OK)
        return ret;

    session->ctx = wolfSSH_CTX_new(WOLFSSH_ENDPOINT_CLIENT, NULL);
    if (session->ctx == NULL) {
        set_error(error, BOARDSSH_ESSH, 0, 0, "wolfSSH_CTX_new failed");
        session_close(session);
        return BOARDSSH_ESSH;
    }

    wolfSSH_SetUserAuth(session->ctx, user_auth_cb);
    wolfSSH_CTX_SetPublicKeyCheck(session->ctx, host_key_check_cb);

    session->ssh = wolfSSH_new(session->ctx);
    if (session->ssh == NULL) {
        set_error(error, BOARDSSH_ESSH, 0, 0, "wolfSSH_new failed");
        session_close(session);
        return BOARDSSH_ESSH;
    }

    wolfSSH_SetUserAuthCtx(session->ssh, &session->identity);
    wolfSSH_SetPublicKeyCheckCtx(session->ssh, (void *)config);

    ret = wolfSSH_SetUsername(session->ssh, config->username);
    if (ret != WS_SUCCESS) {
        set_error(error, BOARDSSH_ESSH, ret, 0, "wolfSSH_SetUsername failed");
        session_close(session);
        return BOARDSSH_ESSH;
    }

    if (config->proxy_command != NULL && config->proxy_command[0] != '\0')
        session->fd = proxy_start(config->proxy_command, &session->proxy_pid, error);
    else
        session->fd = tcp_connect(config->host, config->port, error);

    if (session->fd == BOARDSSH_INVALID_SOCKET) {
        session_close(session);
        return BOARDSSH_EIO;
    }

    ret = wolfSSH_set_fd(session->ssh, session->fd);
    if (ret != WS_SUCCESS) {
        set_error(error, BOARDSSH_ESSH, ret, 0, "wolfSSH_set_fd failed");
        session_close(session);
        return BOARDSSH_ESSH;
    }

    return BOARDSSH_OK;
}

int boardssh_exec(const boardssh_config_t *config, const char *command,
                  boardssh_output_cb output_cb, void *user_data,
                  int *remote_exit_status, boardssh_error_t *error)
{
    boardssh_session_t session;
    byte buffer[8192];
    int ret;
    int n;

    if (command == NULL || command[0] == '\0') {
        set_error(error, BOARDSSH_EINVAL, 0, 0, "command is empty");
        return BOARDSSH_EINVAL;
    }

    ret = session_prepare(config, &session, error);
    if (ret != BOARDSSH_OK)
        return ret;

    ret = wolfSSH_SetChannelType(session.ssh, WOLFSSH_SESSION_EXEC,
            (byte *)command, (word32)strlen(command));
    if (ret != WS_SUCCESS) {
        set_error(error, BOARDSSH_ESSH, ret, 0,
                  "wolfSSH_SetChannelType(exec) failed");
        session_close(&session);
        return BOARDSSH_ESSH;
    }

    ret = wolfSSH_connect(session.ssh);
    if (ret != WS_SUCCESS) {
        int cause = wolfSSH_get_error(session.ssh);
        set_error(error, BOARDSSH_EAUTH, cause, 0,
                  "wolfSSH_connect/authentication failed");
        session_close(&session);
        return BOARDSSH_EAUTH;
    }

    for (;;) {
        n = wolfSSH_stream_read(session.ssh, buffer, sizeof(buffer));
        if (n > 0) {
            if (output_cb != NULL)
                output_cb(buffer, (size_t)n, 0, user_data);
            continue;
        }

        if (n == WS_EXTDATA) {
            for (;;) {
                n = wolfSSH_extended_data_read(session.ssh, buffer,
                                               sizeof(buffer));
                if (n > 0) {
                    if (output_cb != NULL)
                        output_cb(buffer, (size_t)n, 1, user_data);
                    continue;
                }
                break;
            }
            continue;
        }

        if (n == WS_EOF || n == WS_CHANNEL_CLOSED)
            break;

        if (n == WS_REKEYING || n == WS_WANT_READ || n == WS_WANT_WRITE ||
                n == WS_CHAN_RXD) {
            (void)wolfSSH_worker(session.ssh, NULL);
            continue;
        }

        set_error(error, BOARDSSH_ESSH, wolfSSH_get_error(session.ssh), 0,
                  "wolfSSH_stream_read failed");
        session_close(&session);
        return BOARDSSH_ESSH;
    }

    if (remote_exit_status != NULL)
        *remote_exit_status = wolfSSH_GetExitStatus(session.ssh);

    session_close(&session);
    return BOARDSSH_OK;
}

static int boardssh_fd_write(int fd, const void *data, size_t size)
{
#ifdef _WIN32
    return _write(fd, data, (unsigned)size);
#else
    return (int)write(fd, data, size);
#endif
}

static int boardssh_fd_read(int fd, void *data, size_t size)
{
#ifdef _WIN32
    return _read(fd, data, (unsigned)size);
#else
    return (int)read(fd, data, size);
#endif
}

static void boardssh_pause_ms(unsigned ms)
{
#ifdef _WIN32
    Sleep(ms);
#else
    struct timespec pause;
    pause.tv_sec = ms / 1000U;
    pause.tv_nsec = (long)(ms % 1000U) * 1000000L;
    (void)nanosleep(&pause, NULL);
#endif
}

static int write_all_fd(int fd, const byte *data, size_t size)
{
    size_t off = 0;

    while (off < size) {
        int n = boardssh_fd_write(fd, data + off, size - off);
        if (n < 0) {
            if (errno == EINTR)
                continue;
            return -1;
        }
        off += (size_t)n;
    }
    return 0;
}

typedef struct {
    WOLFSSH *ssh;
    pthread_mutex_t lock;
    int input_error;
} boardssh_shell_state_t;

static void *shell_input_thread(void *arg)
{
    boardssh_shell_state_t *state = (boardssh_shell_state_t *)arg;
    byte buffer[1024];
    int n;

    while ((n = boardssh_fd_read(STDIN_FILENO, buffer, sizeof(buffer))) > 0) {
        size_t off = 0;

        while (off < (size_t)n) {
            int ret;
            int cause;

            pthread_mutex_lock(&state->lock);
            ret = wolfSSH_stream_send(state->ssh, buffer + off,
                                      (word32)((size_t)n - off));
            cause = (ret == WS_FATAL_ERROR) ? wolfSSH_get_error(state->ssh)
                                             : ret;
            pthread_mutex_unlock(&state->lock);

            if (ret > 0) {
                off += (size_t)ret;
                continue;
            }
            if (cause == WS_REKEYING || cause == WS_WANT_WRITE ||
                cause == WS_WANT_READ) {
                boardssh_pause_ms(1);
                continue;
            }
            state->input_error = cause;
            return NULL;
        }
    }

    if (n == 0) {
        pthread_mutex_lock(&state->lock);
        (void)wolfSSH_stream_send_eof(state->ssh);
        pthread_mutex_unlock(&state->lock);
    }
    else if (errno != EINTR) {
        state->input_error = errno;
    }
    return NULL;
}

#ifndef _WIN32
static int shell_set_raw(struct termios *saved, int *active)
{
    struct termios raw;

    *active = 0;
    if (!isatty(STDIN_FILENO))
        return 0;
    if (tcgetattr(STDIN_FILENO, saved) != 0)
        return -1;

    raw = *saved;
    raw.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
    raw.c_oflag &= ~(OPOST);
    raw.c_cflag |= CS8;
    raw.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
    raw.c_cc[VMIN] = 1;
    raw.c_cc[VTIME] = 0;
    if (tcsetattr(STDIN_FILENO, TCSANOW, &raw) != 0)
        return -1;
    *active = 1;
    return 0;
}

static void shell_restore_terminal(const struct termios *saved, int active)
{
    if (active)
        (void)tcsetattr(STDIN_FILENO, TCSANOW, saved);
}
#endif

int boardssh_shell(const boardssh_config_t *config,
                   int *remote_exit_status, boardssh_error_t *error)
{
    boardssh_session_t session;
    boardssh_shell_state_t state;
    pthread_t input_thread;
#ifndef _WIN32
    struct termios saved_term;
    struct winsize window;
#endif
    byte buffer[8192];
    int raw_active = 0;
    int thread_started = 0;
    int ret;
    int result = BOARDSSH_OK;

    ret = session_prepare(config, &session, error);
    if (ret != BOARDSSH_OK)
        return ret;

    ret = wolfSSH_SetChannelType(session.ssh, WOLFSSH_SESSION_TERMINAL,
                                 NULL, 0);
    if (ret != WS_SUCCESS) {
        set_error(error, BOARDSSH_ESSH, ret, 0,
                  "wolfSSH_SetChannelType(terminal) failed");
        session_close(&session);
        return BOARDSSH_ESSH;
    }

    ret = wolfSSH_connect(session.ssh);
    if (ret != WS_SUCCESS) {
        int cause = wolfSSH_get_error(session.ssh);
        set_error(error, BOARDSSH_EAUTH, cause, 0,
                  "wolfSSH_connect/authentication failed");
        session_close(&session);
        return BOARDSSH_EAUTH;
    }

    if (config->machine_mode) {
        static const char ready[] = "__BOARDSSH_READY__\n";
        if (write_all_fd(STDERR_FILENO, (const byte *)ready,
                         sizeof(ready) - 1) != 0) {
            set_error(error, BOARDSSH_EIO, 0, errno,
                      "failed to report machine-mode readiness");
            session_close(&session);
            return BOARDSSH_EIO;
        }
    }

#ifndef _WIN32
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &window) == 0 &&
        window.ws_col > 0 && window.ws_row > 0) {
        (void)wolfSSH_ChangeTerminalSize(session.ssh, window.ws_col,
                                         window.ws_row,
                                         window.ws_xpixel, window.ws_ypixel);
    }

    if (shell_set_raw(&saved_term, &raw_active) != 0) {
        set_error(error, BOARDSSH_EIO, 0, errno,
                  "failed to set local terminal raw mode: %s",
                  strerror(errno));
        session_close(&session);
        return BOARDSSH_EIO;
    }
#endif

    memset(&state, 0, sizeof(state));
    state.ssh = session.ssh;
    if (pthread_mutex_init(&state.lock, NULL) != 0) {
#ifndef _WIN32
        shell_restore_terminal(&saved_term, raw_active);
#endif
        set_error(error, BOARDSSH_EIO, 0, errno,
                  "pthread_mutex_init failed");
        session_close(&session);
        return BOARDSSH_EIO;
    }

    if (pthread_create(&input_thread, NULL, shell_input_thread, &state) != 0) {
        pthread_mutex_destroy(&state.lock);
#ifndef _WIN32
        shell_restore_terminal(&saved_term, raw_active);
#endif
        set_error(error, BOARDSSH_EIO, 0, errno,
                  "pthread_create failed");
        session_close(&session);
        return BOARDSSH_EIO;
    }
    thread_started = 1;

    for (;;) {
        fd_set read_set;
        int selected;
        int n;
        int cause;

        FD_ZERO(&read_set);
        FD_SET(session.fd, &read_set);
        selected = select((int)(session.fd + 1), &read_set, NULL, NULL, NULL);
        if (selected < 0) {
#ifdef _WIN32
            int select_error = WSAGetLastError();
            set_error(error, BOARDSSH_EIO, 0, select_error,
                      "select on SSH socket failed: %d", select_error);
#else
            if (errno == EINTR)
                continue;
            set_error(error, BOARDSSH_EIO, 0, errno,
                      "select on SSH socket failed: %s", strerror(errno));
#endif
            result = BOARDSSH_EIO;
            break;
        }
        if (selected == 0 || !FD_ISSET(session.fd, &read_set))
            continue;

        pthread_mutex_lock(&state.lock);
        n = wolfSSH_stream_read(session.ssh, buffer, sizeof(buffer));
        cause = (n == WS_FATAL_ERROR) ? wolfSSH_get_error(session.ssh) : n;

        if (n == WS_EXTDATA) {
            do {
                n = wolfSSH_extended_data_read(session.ssh, buffer,
                                               sizeof(buffer));
                if (n > 0 && write_all_fd(STDERR_FILENO, buffer,
                                            (size_t)n) != 0) {
                    ret = WS_SOCKET_ERROR_E;
                    break;
                }
            } while (n > 0);
            pthread_mutex_unlock(&state.lock);
            continue;
        }

        if (cause == WS_REKEYING) {
            (void)wolfSSH_worker(session.ssh, NULL);
            pthread_mutex_unlock(&state.lock);
            continue;
        }
        pthread_mutex_unlock(&state.lock);

        if (n > 0) {
            if (write_all_fd(STDOUT_FILENO, buffer, (size_t)n) != 0) {
                set_error(error, BOARDSSH_EIO, 0, errno,
                          "stdout write failed: %s", strerror(errno));
                result = BOARDSSH_EIO;
                break;
            }
            continue;
        }

        if (cause == WS_WANT_READ || cause == WS_WANT_WRITE || n == 0)
            continue;
        if (cause == WS_EOF || cause == WS_CHANNEL_CLOSED ||
            cause == WS_SOCKET_ERROR_E)
            break;

        set_error(error, BOARDSSH_ESSH, cause, 0,
                  "interactive SSH stream read failed");
        result = BOARDSSH_ESSH;
        break;
    }

    if (thread_started) {
        (void)pthread_cancel(input_thread);
        (void)pthread_join(input_thread, NULL);
    }
    pthread_mutex_destroy(&state.lock);
#ifndef _WIN32
    shell_restore_terminal(&saved_term, raw_active);
#endif

    if (remote_exit_status != NULL)
        *remote_exit_status = wolfSSH_GetExitStatus(session.ssh);

    session_close(&session);
    return result;
}

static int scp_transfer(const boardssh_config_t *config,
                        const char *src, const char *dst, int upload,
                        boardssh_error_t *error)
{
    boardssh_session_t session;
    int ret;

    if (src == NULL || src[0] == '\0' || dst == NULL || dst[0] == '\0') {
        set_error(error, BOARDSSH_EINVAL, 0, 0, "SCP path is empty");
        return BOARDSSH_EINVAL;
    }

    ret = session_prepare(config, &session, error);
    if (ret != BOARDSSH_OK)
        return ret;

    do {
        ret = upload ? wolfSSH_SCP_to(session.ssh, src, dst)
                     : wolfSSH_SCP_from(session.ssh, src, dst);
        if (ret == WS_FATAL_ERROR)
            ret = wolfSSH_get_error(session.ssh);
    } while (ret == WS_WANT_READ || ret == WS_WANT_WRITE ||
             ret == WS_CHAN_RXD || ret == WS_REKEYING);

    if (ret != WS_SUCCESS) {
        set_error(error, BOARDSSH_ESCP, ret, 0, "wolfSSH SCP transfer failed");
        session_close(&session);
        return BOARDSSH_ESCP;
    }

    session_close(&session);
    return BOARDSSH_OK;
}

int boardssh_scp_put(const boardssh_config_t *config,
                     const char *local_path, const char *remote_path,
                     boardssh_error_t *error)
{
    return scp_transfer(config, local_path, remote_path, 1, error);
}

int boardssh_scp_get(const boardssh_config_t *config,
                     const char *remote_path, const char *local_path,
                     boardssh_error_t *error)
{
    return scp_transfer(config, remote_path, local_path, 0, error);
}
