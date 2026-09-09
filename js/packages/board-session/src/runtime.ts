import * as path from 'node:path';

/**
 * Resolve the native wolfSSH client bundled with this npm package.
 * The first packaged target is Windows x64. Linux deployments normally
 * provide their own wolfssh path because Baton/local layouts are site-specific.
 */
export function resolveBundledWolfssh(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32' && arch === 'x64') {
    return path.join(__dirname, '..', 'native', 'win32-x64', 'wolfssh.exe');
  }
  throw new Error(`No bundled wolfssh native client for ${platform}/${arch}`);
}
