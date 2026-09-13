# GCP board simulator test configuration

Runtime identity follows the product layout and is not stored in this directory:

- local direct client identity: `~/.ssh/client-identity.pem`
- local direct host key database: `~/.ssh/known_hosts`
- E1 Baton client identity: `/home/ubuntu/.ssh/client-identity.pem`
- E1 Baton host key database: `/home/ubuntu/.ssh/known_hosts`

`direct.ssh_config` only provides the local OpenSSH/gcloud IAP management path.
`baton.ssh_config` provides the first OpenSSH hop to E1; E1 then runs company wolfssh.

The GCP simulator currently requires IPv6 for the E1 -> GCP hop. `-DTEST_IPV6`
is test-only and must not be committed into the company wolf source/build configuration.
