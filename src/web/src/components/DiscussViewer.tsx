import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchApi } from '../api/client';
import { wsClient } from '../api/ws';
import { formatDateTime, truncateId } from '../format';
import type { DiscussSession, TranscriptEntry } from '../types';

type DiscussSessionsResponse = {
  discussSessions: DiscussSession[];
};

type DiscussDetailResponse = {
  session: DiscussSession;
  transcript: TranscriptEntry[];
};

export function DiscussViewer() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [sessions, setSessions] = useState<DiscussSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<DiscussSession | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadSessions = async () => {
      try {
        const response = await fetchApi<DiscussSessionsResponse>('/api/discuss');
        if (!active) {
          return;
        }

        setSessions(response.discussSessions);
        setError(null);
      } catch (loadError) {
        if (active) {
          setError(readError(loadError));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadSessions();
    wsClient.connect();

    const unsubscribe = wsClient.subscribe((event) => {
      if (event === 'connected' || event === 'ready' || event === 'discuss:synced') {
        void loadSessions();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setSelectedSession(null);
      setTranscript([]);
      return;
    }

    let active = true;

    const loadTranscript = async () => {
      try {
        const response = await fetchApi<DiscussDetailResponse>(`/api/discuss/${encodeURIComponent(sessionId)}`);
        if (!active) {
          return;
        }

        setSelectedSession(response.session);
        setTranscript(response.transcript);
        setError(null);
      } catch (loadError) {
        if (active) {
          setError(readError(loadError));
        }
      }
    };

    void loadTranscript();

    const unsubscribe = wsClient.subscribe((event, data) => {
      if (event === 'ready' || event === 'connected') {
        void loadTranscript();
        return;
      }

      if (event === 'discuss:synced' && data.sessionId === sessionId) {
        void loadTranscript();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId]);

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
          AC22
        </div>
        <h2 style={{ marginTop: 8, fontSize: 34, lineHeight: 1.05 }}>Discuss Viewer</h2>
        <p style={{ marginTop: 10, maxWidth: 740, color: '#475569', lineHeight: 1.7 }}>
          Browse discuss sessions and inspect transcript entries including speeches, bids, and summaries.
        </p>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        <section className="panel" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div>
            <h3 style={{ fontSize: 20 }}>Sessions</h3>
            <p style={{ marginTop: 6, color: '#64748b' }}>
              {loading ? 'Loading discuss sessions...' : `${sessions.length} indexed sessions`}
            </p>
          </div>

          {sessions.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              onClick={() => {
                navigate(`/discuss/${encodeURIComponent(session.sessionId)}`);
              }}
              style={{
                textAlign: 'left',
                padding: '14px',
                borderRadius: 16,
                border: session.sessionId === sessionId
                  ? '1px solid rgba(29, 78, 216, 0.28)'
                  : '1px solid rgba(15, 23, 42, 0.08)',
                background: session.sessionId === sessionId
                  ? 'rgba(219, 234, 254, 0.52)'
                  : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <strong>{session.topic}</strong>
              <div style={{ marginTop: 8, color: '#475569', fontSize: 13, lineHeight: 1.6 }}>
                <div>{truncateId(session.sessionId)}</div>
                <div>Status: {session.status}</div>
                <div>Last activity: {formatDateTime(session.lastActivityAt)}</div>
              </div>
            </button>
          ))}

          {!loading && sessions.length === 0 ? (
            <div style={{ color: '#64748b' }}>No discuss sessions indexed yet.</div>
          ) : null}
        </section>

        <section className="panel" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          {selectedSession ? (
            <>
              <div>
                <h3 style={{ fontSize: 20 }}>{selectedSession.topic}</h3>
                <p style={{ marginTop: 6, color: '#64748b' }}>
                  {truncateId(selectedSession.sessionId)} · {selectedSession.status} · {formatDateTime(selectedSession.lastActivityAt)}
                </p>
              </div>

              {transcript.length === 0 ? (
                <div style={{ color: '#64748b' }}>No transcript entries stored for this session.</div>
              ) : (
                transcript.map((entry) => (
                  <article
                    key={entry.id}
                    style={{
                      padding: '14px',
                      borderRadius: 16,
                      background: '#ffffff',
                      border: '1px solid rgba(15, 23, 42, 0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <strong>{entry.kind}</strong>
                      <span className="pill">seq {entry.seq}</span>
                    </div>
                    <div style={{ marginTop: 10, color: '#475569', fontSize: 13, lineHeight: 1.6 }}>
                      <div>Agent: {entry.agent ?? 'n/a'}</div>
                      <div>Epoch: {entry.epoch ?? 'n/a'} · Round: {entry.round ?? 'n/a'}</div>
                      <div>{formatDateTime(entry.ts)}</div>
                    </div>
                    <pre
                      style={{
                        marginTop: 12,
                        padding: '12px',
                        borderRadius: 14,
                        background: '#f8fafc',
                        overflowX: 'auto',
                        fontSize: 12,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {entry.content ?? entry.payload ?? 'No content stored.'}
                    </pre>
                  </article>
                ))
              )}
            </>
          ) : (
            <div style={{ color: '#64748b' }}>
              Select a discuss session from the list to load its transcript.
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
