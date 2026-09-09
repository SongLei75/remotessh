#include "boardssh.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#ifdef _WIN32
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#endif

static void usage(const char *prog)
{
    fprintf(stderr,
        "usage: %s -N [-M] -h HOST [-p PORT] -u USER -c CERT -i KEY -K KNOWN_HOSTS [-A ALIAS]\n",
        prog);
}

int main(int argc, char **argv)
{
    boardssh_config_t config;
    boardssh_error_t error;
    const char *host = NULL;
    const char *user = NULL;
    const char *cert = NULL;
    const char *key = NULL;
    const char *known_hosts = NULL;
    const char *alias = NULL;
    uint16_t port = 22;
    int machine_mode = 0;
    int remote_status = -1;
    int i;
    int ret;

    memset(&config, 0, sizeof(config));
    memset(&error, 0, sizeof(error));

#ifdef _WIN32
    /* Node/VS Code drive this process through binary-safe pipes. */
    (void)_setmode(_fileno(stdin), _O_BINARY);
    (void)_setmode(_fileno(stdout), _O_BINARY);
    (void)_setmode(_fileno(stderr), _O_BINARY);
#endif

    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "-N") == 0)
            continue;
        if (strcmp(argv[i], "-M") == 0) {
            machine_mode = 1;
            continue;
        }
        if (i + 1 >= argc) {
            usage(argv[0]);
            return 2;
        }
        if (strcmp(argv[i], "-h") == 0)
            host = argv[++i];
        else if (strcmp(argv[i], "-u") == 0)
            user = argv[++i];
        else if (strcmp(argv[i], "-c") == 0)
            cert = argv[++i];
        else if (strcmp(argv[i], "-i") == 0)
            key = argv[++i];
        else if (strcmp(argv[i], "-K") == 0)
            known_hosts = argv[++i];
        else if (strcmp(argv[i], "-A") == 0)
            alias = argv[++i];
        else if (strcmp(argv[i], "-p") == 0) {
            unsigned long value = strtoul(argv[++i], NULL, 10);
            if (value == 0 || value > 65535) {
                fprintf(stderr, "invalid port\n");
                return 2;
            }
            port = (uint16_t)value;
        }
        else {
            usage(argv[0]);
            return 2;
        }
    }

    if (host == NULL || user == NULL || cert == NULL || key == NULL ||
        known_hosts == NULL) {
        usage(argv[0]);
        return 2;
    }

    config.host = host;
    config.port = port;
    config.username = user;
    config.cert_file = cert;
    config.private_key_file = key;
    config.known_hosts_file = known_hosts;
    config.host_key_alias = alias;
    config.proxy_command = NULL;
    config.machine_mode = machine_mode;

    ret = boardssh_shell(&config, &remote_status, &error);
    if (ret != BOARDSSH_OK) {
        fprintf(stderr, "boardssh error: %s (code=%d wolfssh=%d errno=%d)\n",
                error.message, error.code, error.wolfssh_code, error.sys_errno);
        return 1;
    }
    return remote_status < 0 ? 0 : remote_status;
}
