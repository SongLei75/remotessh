# GCP board simulator

Runtime identities are not stored in this directory:

- Direct: `~/.ssh/client-identity.pem` and `~/.ssh/known_hosts`
- Baton E1: `/home/ubuntu/.ssh/client-identity.pem` and `/home/ubuntu/.ssh/known_hosts`

`baton.ssh_config` describes only the first hop to OCI E1. The second hop is always company wolfSSH running on E1.

Direct access does not use an OpenSSH host profile. The demo opens a temporary GCP IAP TCP tunnel and connects through it with local company wolfSSH.
