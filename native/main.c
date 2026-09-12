#include "boardssh.h"
#include "ssh_config.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void output_cb(const void *data, size_t size, int is_stderr,
                      void *user_data)
{
    FILE *stream = is_stderr ? stderr : stdout;
    (void)user_data;
    fwrite(data, 1, size, stream);
    fflush(stream);
}

static const char *base_name(const char *path)
{
    const char *slash = strrchr(path, '/');
    return slash != NULL ? slash + 1 : path;
}

static void usage(const char *prog)
{
    fprintf(stderr,
        "usage:\n"
        "  %s [options] destination -- COMMAND [ARG ...]\n"
        "  wolfscp [options] destination put LOCAL REMOTE\n"
        "  wolfscp [options] destination get REMOTE LOCAL\n"
        "\n"
        "options:\n"
        "  -F FILE       OpenSSH-style client config (default ~/.ssh/config)\n"
        "  -N            do not read any SSH config file\n"
        "  -M            machine mode; emit readiness marker after login\n"
        "  -G            print resolved configuration and exit\n"
        "  -h HOST       override HostName / direct host\n"
        "  -p PORT       override Port\n"
        "  -u USER       override User\n"
        "  -c CERT       override CertificateFile\n"
        "  -i KEY        override IdentityFile\n"
        "  -K FILE       override UserKnownHostsFile\n"
        "  -A ALIAS      override HostKeyAlias\n"
        "  -P COMMAND    override ProxyCommand\n",
        prog);
}

static char *join_command(int argc, char **argv, int start)
{
    size_t total = 1;
    char *cmd;
    int i;

    for (i = start; i < argc; ++i)
        total += strlen(argv[i]) + 1;

    cmd = (char *)malloc(total);
    if (cmd == NULL)
        return NULL;
    cmd[0] = '\0';

    for (i = start; i < argc; ++i) {
        if (i != start)
            strcat(cmd, " ");
        strcat(cmd, argv[i]);
    }
    return cmd;
}

static int make_default_config_path(char *out, size_t out_size)
{
    const char *home = getenv("HOME");
    int n;

    if (home == NULL || home[0] == '\0')
        return -1;
    n = snprintf(out, out_size, "%s/.ssh/config", home);
    return (n > 0 && (size_t)n < out_size) ? 0 : -1;
}

static void print_config(const char *destination,
                         const boardssh_config_t *config)
{
    printf("destination %s\n", destination != NULL ? destination : "none");
    printf("hostname %s\n", config->host != NULL ? config->host : "none");
    printf("port %u\n", (unsigned)config->port);
    printf("user %s\n", config->username != NULL ? config->username : "none");
    printf("identityfile %s\n",
           config->private_key_file != NULL ? config->private_key_file : "none");
    printf("certificatefile %s\n",
           config->cert_file != NULL ? config->cert_file : "none");
    printf("userknownhostsfile %s\n",
           config->known_hosts_file != NULL ? config->known_hosts_file : "none");
    printf("hostkeyalias %s\n",
           config->host_key_alias != NULL ? config->host_key_alias : "none");
    printf("proxycommand %s\n",
           config->proxy_command != NULL ? config->proxy_command : "none");
}

int main(int argc, char **argv)
{
    boardssh_config_t config = {0};
    boardssh_error_t error = {0};
    ssh_config_values_t ssh_cfg = {0};
    const char *prog = base_name(argv[0]);
    const char *destination = NULL;
    const char *cli_host = NULL;
    const char *cli_user = NULL;
    const char *cli_cert = NULL;
    const char *cli_key = NULL;
    const char *cli_known_hosts = NULL;
    const char *cli_host_key_alias = NULL;
    const char *cli_proxy_command = NULL;
    const char *config_path = NULL;
    char default_config[PATH_MAX];
    char config_error[256] = {0};
    uint16_t cli_port = 0;
    int cli_port_set = 0;
    int no_config = 0;
    int machine_mode = 0;
    int print_only = 0;
    int is_scp = strcmp(prog, "wolfscp") == 0;
    int argi = 1;
    int ret = BOARDSSH_OK;
    int exit_code = 0;

    if (make_default_config_path(default_config, sizeof(default_config)) == 0)
        config_path = default_config;

    while (argi < argc) {
        if (strcmp(argv[argi], "--") == 0)
            break;
        if (argv[argi][0] != '-' || argv[argi][1] == '\0')
            break;

        if (strcmp(argv[argi], "-G") == 0) {
            print_only = 1;
            ++argi;
            continue;
        }
        if (strcmp(argv[argi], "-N") == 0) {
            no_config = 1;
            config_path = NULL;
            ++argi;
            continue;
        }
        if (strcmp(argv[argi], "-M") == 0) {
            machine_mode = 1;
            ++argi;
            continue;
        }
        if (argi + 1 >= argc) {
            usage(prog);
            return 2;
        }

        if (strcmp(argv[argi], "-F") == 0) {
            config_path = argv[argi + 1];
            no_config = 0;
        }
        else if (strcmp(argv[argi], "-h") == 0)
            cli_host = argv[argi + 1];
        else if (strcmp(argv[argi], "-p") == 0) {
            unsigned long p = strtoul(argv[argi + 1], NULL, 10);
            if (p == 0 || p > 65535) {
                fprintf(stderr, "invalid port: %s\n", argv[argi + 1]);
                return 2;
            }
            cli_port = (uint16_t)p;
            cli_port_set = 1;
        }
        else if (strcmp(argv[argi], "-u") == 0)
            cli_user = argv[argi + 1];
        else if (strcmp(argv[argi], "-c") == 0)
            cli_cert = argv[argi + 1];
        else if (strcmp(argv[argi], "-i") == 0)
            cli_key = argv[argi + 1];
        else if (strcmp(argv[argi], "-K") == 0)
            cli_known_hosts = argv[argi + 1];
        else if (strcmp(argv[argi], "-A") == 0)
            cli_host_key_alias = argv[argi + 1];
        else if (strcmp(argv[argi], "-P") == 0)
            cli_proxy_command = argv[argi + 1];
        else {
            usage(prog);
            return 2;
        }
        argi += 2;
    }

    if (argi < argc && strcmp(argv[argi], "--") == 0)
        ++argi;

    if (cli_host == NULL) {
        if (argi >= argc) {
            usage(prog);
            return 2;
        }
        destination = argv[argi++];
    }
    else {
        destination = cli_host;
    }

    if (!no_config && config_path != NULL) {
        if (ssh_config_load(config_path, destination, &ssh_cfg,
                            config_error, sizeof(config_error)) != 0) {
            fprintf(stderr, "ssh config: %s\n", config_error);
            return 2;
        }
    }

    config.host = cli_host != NULL ? cli_host :
                  (ssh_cfg.host_name != NULL ? ssh_cfg.host_name : destination);
    config.port = cli_port_set ? cli_port :
                  (ssh_cfg.port != 0 ? ssh_cfg.port : 22);
    config.username = cli_user != NULL ? cli_user : ssh_cfg.user;
    if (config.username == NULL)
        config.username = getenv("USER");
    config.cert_file = cli_cert != NULL ? cli_cert : ssh_cfg.certificate_file;
    config.private_key_file = cli_key != NULL ? cli_key : ssh_cfg.identity_file;
    config.known_hosts_file = cli_known_hosts != NULL ? cli_known_hosts :
                              ssh_cfg.user_known_hosts_file;
    config.host_key_alias = cli_host_key_alias != NULL ? cli_host_key_alias :
                            ssh_cfg.host_key_alias;
    config.proxy_command = cli_proxy_command != NULL ? cli_proxy_command :
                           ssh_cfg.proxy_command;
    config.machine_mode = machine_mode;

    if (print_only) {
        print_config(destination, &config);
        goto done;
    }

    if (config.host == NULL || config.username == NULL ||
        config.cert_file == NULL || config.private_key_file == NULL ||
        config.known_hosts_file == NULL) {
        fprintf(stderr,
                "incomplete SSH configuration for %s; need HostName/User/IdentityFile/"
                "CertificateFile/UserKnownHostsFile\n",
                destination);
        exit_code = 2;
        goto done;
    }

    if (is_scp) {
        if (argc - argi != 3) {
            usage(prog);
            exit_code = 2;
            goto done;
        }
        if (strcmp(argv[argi], "put") == 0)
            ret = boardssh_scp_put(&config, argv[argi + 1], argv[argi + 2],
                                   &error);
        else if (strcmp(argv[argi], "get") == 0)
            ret = boardssh_scp_get(&config, argv[argi + 1], argv[argi + 2],
                                   &error);
        else {
            usage(prog);
            exit_code = 2;
            goto done;
        }
    }
    else {
        char *command;
        int remote_status = -1;

        if (argi < argc && strcmp(argv[argi], "--") == 0)
            ++argi;
        if (argi >= argc) {
            ret = boardssh_shell(&config, &remote_status, &error);
            if (ret == BOARDSSH_OK) {
                exit_code = remote_status;
                goto done;
            }
            goto report_error;
        }
        command = join_command(argc, argv, argi);
        if (command == NULL) {
            fprintf(stderr, "out of memory\n");
            exit_code = 1;
            goto done;
        }
        ret = boardssh_exec(&config, command, output_cb, NULL,
                            &remote_status, &error);
        free(command);
        if (ret == BOARDSSH_OK) {
            exit_code = remote_status;
            goto done;
        }
    }

report_error:
    if (ret != BOARDSSH_OK) {
        fprintf(stderr, "boardssh error: %s (code=%d wolfssh=%d errno=%d)\n",
                error.message, error.code, error.wolfssh_code,
                error.sys_errno);
        exit_code = 1;
    }

done:
    ssh_config_values_free(&ssh_cfg);
    return exit_code;
}
