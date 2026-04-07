import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { backendInfoPath } from 'coral/infra';

const require = createRequire(import.meta.url);

export function resolveCoralPluginRoot(): string {
  const clientEntry = require.resolve('coral/client');
  return resolve(dirname(clientEntry), '../..');
}

export const LOCAL_BACKEND_INFO_PATH = backendInfoPath(resolveCoralPluginRoot());
