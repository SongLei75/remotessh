#ifndef BOARDSSH_H
#define BOARDSSH_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    const char *host;
    uint16_t port;
    const char *username;
    const char *cert_file;
    const char *private_key_file;
    const char *known_hosts_file;
    const char *host_key_alias;
    const char *proxy_command;
    int machine_mode;
} boardssh_config_t;

typedef struct {
    int code;
    int wolfssh_code;
    int sys_errno;
    char message[256];
} boardssh_error_t;

typedef void (*boardssh_output_cb)(const void *data, size_t size,
                                   int is_stderr, void *user_data);

enum {
    BOARDSSH_OK = 0,
    BOARDSSH_EINVAL = -1,
    BOARDSSH_EIO = -2,
    BOARDSSH_EAUTH = -3,
    BOARDSSH_ESSH = -4,
    BOARDSSH_ESCP = -5
};

int boardssh_exec(const boardssh_config_t *config, const char *command,
                  boardssh_output_cb output_cb, void *user_data,
                  int *remote_exit_status, boardssh_error_t *error);

int boardssh_shell(const boardssh_config_t *config,
                   int *remote_exit_status, boardssh_error_t *error);

int boardssh_scp_put(const boardssh_config_t *config,
                     const char *local_path, const char *remote_path,
                     boardssh_error_t *error);

int boardssh_scp_get(const boardssh_config_t *config,
                     const char *remote_path, const char *local_path,
                     boardssh_error_t *error);

#ifdef __cplusplus
}
#endif

#endif
