import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWolfsshArgs, buildRemoteWolfsshCommand } from './command';

test('direct route uses explicit no-config arguments', () => {
  const args = buildWolfsshArgs(
    { host: '10.0.0.2', port: 2222, username: 'root' },
    {
      executable: 'wolfssh',
      identity: {
        certificateFile: '/c.pem',
        privateKeyFile: '/k.pem',
        knownHostsFile: '/kh',
        hostKeyAlias: 'board',
      },
    },
  );
  assert.deepEqual(args, ['-M', '-N', '-h', '10.0.0.2', '-p', '2222', '-u', 'root', '-c', '/c.pem', '-i', '/k.pem', '-K', '/kh', '-A', 'board']);
});

test('remote command shell-quotes every argument', () => {
  const command = buildRemoteWolfsshCommand(
    { host: '10.0.0.2', username: 'root' },
    {
      executable: '/opt/wolf ssh/wolfssh',
      identity: {
        certificateFile: "/x/a'b.pem",
        privateKeyFile: '/x/k.pem',
        knownHostsFile: '/x/known_hosts',
      },
    },
  );
  assert.match(command, /^exec '\/opt\/wolf ssh\/wolfssh'/);
  assert.match(command, /'\/x\/a'\\''b\.pem'/);
});
