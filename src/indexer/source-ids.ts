import { createHash } from 'node:crypto';

const LOCAL_AUTO = 'local:auto';

export function toReefId(connectionId: string, originId: string): string {
  if (connectionId === LOCAL_AUTO) return originId;
  return `${connectionId}:${originId}`;
}

export function projectKey(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
}

export function toDiscussReefId(params: {
  connectionId: string;
  projectRoot: string;
  originDiscussSessionId: string;
}): string {
  const { connectionId, projectRoot, originDiscussSessionId } = params;
  return `${connectionId}:${projectKey(projectRoot)}:${originDiscussSessionId}`;
}
