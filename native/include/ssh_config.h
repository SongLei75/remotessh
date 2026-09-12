#ifndef SSH_CONFIG_H
#define SSH_CONFIG_H

#include <stdint.h>
#include <stddef.h>

typedef struct {
    char *host_name;
    char *user;
    char *identity_file;
    char *certificate_file;
    char *user_known_hosts_file;
    char *host_key_alias;
    char *proxy_command;
    uint16_t port;
    int matched_host;
} ssh_config_values_t;

int ssh_config_load(const char *path, const char *host_alias,
                    ssh_config_values_t *values,
                    char *error, size_t error_size);
void ssh_config_values_free(ssh_config_values_t *values);

#endif
