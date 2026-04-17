import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { postApi } from '../api/client';
import { wsClient } from '../api/ws';
import { formatDateTime, truncateId } from '../format';
import type { ChatResponse } from '../types';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
};

type LiveEvent = {
  id: string;
  event: string;
  content: string;
  ts: string;
};

export function ChatUI() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wsClient.connect();
    const unsubscribe = wsClient.subscribe((event, data) => {
      if (event !== 'connected' && event !== 'ready' && !event.startsWith('job:')) {
        return;
      }

      const entry: LiveEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        event,
        content: describeEvent(event, data),
        ts: new Date().toISOString(),
      };

      setLiveEvents((current) => [entry, ...current].slice(0, 20));
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleSend = async () => {
    const message = draft.trim();
    if (message === '' || sending) {
      return;
    }

    const now = new Date().toISOString();
    setSending(true);
    setError(null);
    setDraft('');
    setMessages((current) => [
      ...current,
      { id: `user-${now}`, role: 'user', content: message, ts: now },
    ]);

    try {
      const response = await postApi<ChatResponse>('/api/chat', {
        sessionId: sessionId ?? null,
        message,
      });

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${response.receivedAt}`,
          role: 'assistant',
          content: response.reply,
          ts: response.receivedAt,
        },
      ]);
    } catch (sendError) {
      const messageText = readError(sendError);
      setError(messageText);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: `Chat request failed: ${messageText}`,
          ts: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
          AC25
        </div>
        <h2 style={{ fontSize: 34, lineHeight: 1.05 }}>Chat UI</h2>
        <p style={{ color: '#475569', maxWidth: 760, lineHeight: 1.7 }}>
          The input posts to <code>/api/chat</code>, which is a server stub for now. The side panel shows live relay traffic from <code>/ws</code> so operator activity remains visible while chat wiring is still pending.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span className="pill">Endpoint: /api/chat</span>
          <span className="pill">
            Session: {sessionId ? truncateId(sessionId) : 'ad hoc'}
          </span>
        </div>
      </header>

      {error ? (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 16,
            background: 'rgba(254, 242, 242, 0.95)',
            border: '1px solid rgba(220, 38, 38, 0.16)',
            color: '#991b1b',
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        <section className="panel" style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: 20 }}>Conversation</h3>
              <p style={{ marginTop: 6, color: '#64748b' }}>Local transcript rendered from the stub response.</p>
            </div>
            <span className="pill">{messages.length} messages</span>
          </div>

          <div
            style={{
              minHeight: 340,
              display: 'grid',
              gap: 12,
              alignContent: 'start',
              padding: '4px 0',
            }}
          >
            {messages.length === 0 ? (
              <div
                style={{
                  padding: '18px',
                  borderRadius: 16,
                  background: '#f8fafc',
                  color: '#64748b',
                  lineHeight: 1.6,
                }}
              >
                Send a prompt to exercise the stub endpoint and watch live backend events on the right.
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  style={{
                    justifySelf: message.role === 'user' ? 'end' : 'start',
                    maxWidth: '80%',
                    padding: '14px 16px',
                    borderRadius: 18,
                    background: message.role === 'user'
                      ? 'linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%)'
                      : '#ffffff',
                    color: message.role === 'user' ? '#eff6ff' : '#0f172a',
                    border: message.role === 'user' ? 'none' : '1px solid rgba(15, 23, 42, 0.08)',
                    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {message.role}
                  </div>
                  <div style={{ marginTop: 8, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{message.content}</div>
                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72 }}>
                    {formatDateTime(message.ts)}
                  </div>
                </article>
              ))
            )}
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <textarea
              rows={4}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              placeholder="Describe what you want the chat workflow to do."
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ color: '#64748b', fontSize: 13 }}>
                The current backend response is intentionally stubbed.
              </div>
              <button type="button" onClick={() => void handleSend()} disabled={sending || draft.trim() === ''}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </section>

        <section className="panel" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div>
            <h3 style={{ fontSize: 20 }}>Live Progress Feed</h3>
            <p style={{ marginTop: 6, color: '#64748b' }}>Recent relay events from the shared WebSocket connection.</p>
          </div>

          {liveEvents.length === 0 ? (
            <div style={{ color: '#64748b' }}>Waiting for WebSocket activity...</div>
          ) : (
            liveEvents.map((entry) => (
              <article
                key={entry.id}
                style={{
                  padding: '14px',
                  borderRadius: 16,
                  background: '#ffffff',
                  border: '1px solid rgba(15, 23, 42, 0.08)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <strong>{entry.event}</strong>
                  <span className="pill">{formatDateTime(entry.ts)}</span>
                </div>
                <p style={{ marginTop: 10, color: '#475569', lineHeight: 1.6 }}>{entry.content}</p>
              </article>
            ))
          )}
        </section>
      </div>
    </section>
  );
}

function describeEvent(event: string, data: Record<string, unknown>): string {
  if (event === 'connected') {
    const streamId = typeof data.streamId === 'string' ? data.streamId : 'unknown';
    const state = typeof data.sseState === 'string' ? data.sseState : 'unknown';
    return `Relay connected. streamId=${streamId}, sseState=${state}`;
  }

  const message = typeof data.message === 'string' ? data.message : null;
  const jobId = typeof data.jobId === 'string' ? truncateId(data.jobId) : null;
  const phase = typeof data.phase === 'string' ? data.phase : null;

  if (message && jobId) {
    return `${jobId}: ${message}`;
  }

  if (phase && jobId) {
    return `${jobId}: phase -> ${phase}`;
  }

  if (jobId) {
    return `${jobId}: live update received`;
  }

  return JSON.stringify(data);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
