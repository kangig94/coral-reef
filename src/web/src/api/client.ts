async function readResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: unknown = null;

  if (raw !== '') {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(body, response.status));
  }

  return body as T;
}

function readErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if ('error' in body && typeof body.error === 'string') {
      return body.error;
    }
  }

  return `API error: ${status}`;
}

export async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  return readResponse<T>(response);
}

export async function postApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse<T>(response);
}
