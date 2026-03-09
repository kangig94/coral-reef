import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './router.js';

type ChatRequest = {
  message: string;
  sessionId: string | null;
};

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/chat') {
    return false;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  }

  const body = await readJsonBody(req);
  if (!body) {
    sendJson(res, 400, { error: 'invalid_json' });
    return true;
  }

  const parsed = parseChatRequest(body);
  if (!parsed) {
    sendJson(res, 400, { error: 'invalid_chat_request' });
    return true;
  }

  sendJson(res, 200, {
    sessionId: parsed.sessionId,
    reply: 'Chat API stub received your message. Wire this route to Coral execution next.',
    receivedAt: new Date().toISOString(),
    stub: true,
  });
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  let raw = '';

  for await (const chunk of req) {
    raw += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  }

  if (raw.trim() === '') {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseChatRequest(value: unknown): ChatRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const message = 'message' in value && typeof value.message === 'string'
    ? value.message.trim()
    : '';
  const sessionId = 'sessionId' in value && typeof value.sessionId === 'string'
    ? value.sessionId
    : null;

  if (message === '') {
    return null;
  }

  return {
    message,
    sessionId,
  };
}
