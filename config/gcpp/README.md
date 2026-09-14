# GCP board simulator

Runtime identities are not stored in this directory:

- Direct: `~/.ssh/client-identity.pem` and `~/.ssh/known_hosts`
- Jump server E1: `/home/ubuntu/.ssh/client-identity.pem` and `/home/ubuntu/.ssh/known_hosts`

Every environment that performs the final board hop must provide working `wolfssh` and `wolfscp` commands in `PATH` and configure their dynamic-library lookup itself.

`baton.ssh_config` describes only the first hop to OCI E1. The second hop runs `wolfssh` from E1's normal runtime environment.

Direct access does not use an OpenSSH host profile. The demo opens a temporary GCP IAP TCP tunnel and connects through it with local company wolfSSH.
