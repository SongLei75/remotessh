#define _POSIX_C_SOURCE 200809L

#include "ssh_config.h"

#include <ctype.h>
#include <errno.h>
#include <fnmatch.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

static char *trim(char *s)
{
    char *end;

    while (*s != '\0' && isspace((unsigned char)*s))
        ++s;
    end = s + strlen(s);
    while (end > s && isspace((unsigned char)end[-1]))
        --end;
    *end = '\0';
    return s;
}

static int pattern_matches(const char *pattern, const char *host)
{
    int flags = 0;
#ifdef FNM_CASEFOLD
    flags |= FNM_CASEFOLD;
#endif
    return fnmatch(pattern, host, flags) == 0;
}

static int host_list_matches(char *patterns, const char *host)
{
    char *save = NULL;
    char *token;
    int positive = 0;

    for (token = strtok_r(patterns, " \t", &save);
         token != NULL;
         token = strtok_r(NULL, " \t", &save)) {
        if (token[0] == '!') {
            if (token[1] != '\0' && pattern_matches(token + 1, host))
                return 0;
        }
        else if (pattern_matches(token, host)) {
            positive = 1;
        }
    }

    return positive;
}

static char *dup_unquoted(const char *value)
{
    const char *start = value;
    size_t len;
    char *out;

    while (*start != '\0' && isspace((unsigned char)*start))
        ++start;
    len = strlen(start);
    while (len > 0 && isspace((unsigned char)start[len - 1]))
        --len;

    if (len >= 2 && ((start[0] == '"' && start[len - 1] == '"') ||
                     (start[0] == '\'' && start[len - 1] == '\''))) {
        ++start;
        len -= 2;
    }

    out = malloc(len + 1);
    if (out == NULL)
        return NULL;
    memcpy(out, start, len);
    out[len] = '\0';
    return out;
}

static char *expand_home(const char *value)
{
    const char *home;
    char *out;
    size_t home_len;
    size_t rest_len;

    if (value == NULL)
        return NULL;
    if (value[0] != '~' || (value[1] != '/' && value[1] != '\0'))
        return strdup(value);

    home = getenv("HOME");
    if (home == NULL || home[0] == '\0')
        return strdup(value);

    home_len = strlen(home);
    rest_len = strlen(value + 1);
    out = malloc(home_len + rest_len + 1);
    if (out == NULL)
        return NULL;
    memcpy(out, home, home_len);
    memcpy(out + home_len, value + 1, rest_len + 1);
    return out;
}

static int set_string_once(char **dst, const char *value, int expand)
{
    char *raw;
    char *final;

    if (*dst != NULL)
        return 0;

    raw = dup_unquoted(value);
    if (raw == NULL)
        return -1;
    if (!expand) {
        *dst = raw;
        return 0;
    }

    final = expand_home(raw);
    free(raw);
    if (final == NULL)
        return -1;
    *dst = final;
    return 0;
}

static int parse_port_once(uint16_t *dst, const char *value)
{
    char *end = NULL;
    unsigned long port;

    if (*dst != 0)
        return 0;

    errno = 0;
    port = strtoul(value, &end, 10);
    while (end != NULL && *end != '\0' && isspace((unsigned char)*end))
        ++end;
    if (errno != 0 || end == value || (end != NULL && *end != '\0') ||
        port == 0 || port > 65535) {
        return -1;
    }
    *dst = (uint16_t)port;
    return 0;
}

static void split_keyword_value(char *line, char **keyword, char **value)
{
    char *p = trim(line);
    char *sep = p;

    while (*sep != '\0' && !isspace((unsigned char)*sep) && *sep != '=')
        ++sep;

    if (*sep == '\0') {
        *keyword = p;
        *value = sep;
        return;
    }

    *sep++ = '\0';
    while (*sep != '\0' && (isspace((unsigned char)*sep) || *sep == '='))
        ++sep;

    *keyword = p;
    *value = trim(sep);
}

int ssh_config_load(const char *path, const char *host_alias,
                    ssh_config_values_t *values,
                    char *error, size_t error_size)
{
    FILE *fp;
    char *line = NULL;
    size_t cap = 0;
    ssize_t got;
    unsigned long line_no = 0;
    int active = 1;
    int ret = 0;

    if (path == NULL || host_alias == NULL || values == NULL) {
        if (error != NULL && error_size > 0)
            snprintf(error, error_size, "invalid ssh config arguments");
        return -1;
    }

    memset(values, 0, sizeof(*values));
    fp = fopen(path, "r");
    if (fp == NULL) {
        if (errno == ENOENT)
            return 0;
        if (error != NULL && error_size > 0)
            snprintf(error, error_size, "%s: %s", path, strerror(errno));
        return -1;
    }

    while ((got = getline(&line, &cap, fp)) >= 0) {
        char *keyword;
        char *value;
        char *comment;

        (void)got;
        ++line_no;

        comment = strchr(line, '#');
        if (comment != NULL)
            *comment = '\0';
        if (*trim(line) == '\0')
            continue;

        split_keyword_value(line, &keyword, &value);
        if (keyword[0] == '\0')
            continue;

        if (strcasecmp(keyword, "Host") == 0) {
            char *patterns = strdup(value);
            if (patterns == NULL) {
                ret = -1;
                break;
            }
            active = host_list_matches(patterns, host_alias);
            if (active)
                values->matched_host = 1;
            free(patterns);
            continue;
        }

        if (strcasecmp(keyword, "Match") == 0) {
            /* This small client does not implement Match blocks. Fail closed
             * until the next Host block rather than applying Match contents. */
            active = 0;
            continue;
        }

        if (!active)
            continue;

        if (strcasecmp(keyword, "HostName") == 0) {
            ret = set_string_once(&values->host_name, value, 0);
        }
        else if (strcasecmp(keyword, "User") == 0) {
            ret = set_string_once(&values->user, value, 0);
        }
        else if (strcasecmp(keyword, "Port") == 0) {
            ret = parse_port_once(&values->port, value);
        }
        else if (strcasecmp(keyword, "IdentityFile") == 0) {
            ret = set_string_once(&values->identity_file, value, 1);
        }
        else if (strcasecmp(keyword, "CertificateFile") == 0) {
            ret = set_string_once(&values->certificate_file, value, 1);
        }
        else if (strcasecmp(keyword, "UserKnownHostsFile") == 0) {
            ret = set_string_once(&values->user_known_hosts_file, value, 1);
        }
        else if (strcasecmp(keyword, "HostKeyAlias") == 0) {
            ret = set_string_once(&values->host_key_alias, value, 0);
        }
        else if (strcasecmp(keyword, "ProxyCommand") == 0) {
            ret = set_string_once(&values->proxy_command, value, 0);
        }

        if (ret != 0) {
            if (error != NULL && error_size > 0)
                snprintf(error, error_size, "%s:%lu: invalid or out-of-memory value for %s",
                         path, line_no, keyword);
            break;
        }
    }

    free(line);
    fclose(fp);

    if (ret != 0)
        ssh_config_values_free(values);
    return ret;
}

void ssh_config_values_free(ssh_config_values_t *values)
{
    if (values == NULL)
        return;
    free(values->host_name);
    free(values->user);
    free(values->identity_file);
    free(values->certificate_file);
    free(values->user_known_hosts_file);
    free(values->host_key_alias);
    free(values->proxy_command);
    memset(values, 0, sizeof(*values));
}
