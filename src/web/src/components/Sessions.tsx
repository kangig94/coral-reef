import { useEffect, useState } from 'react';
import { fetchApi } from '../api/client';
import { wsClient } from '../api/ws';
import { formatDateTime, truncateId } from '../format';
import type { Session } from '../types';

type SessionsResponse = { sessions: Session[] };
type SessionResponse = { session: Session };

export function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadSessions = async () => {
      try {
        const response = await fetchApi<SessionsResponse>('/api/sessions');
        if (!active) {
          return;
        }

        setSessions(response.sessions);
        setSelectedId((current) => {
          if (current && response.sessions.some((session) => session.sessionId === current)) {
            return current;
          }

          return response.sessions[0]?.sessionId ?? null;
        });
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
      if (event === 'connected' || event === 'ready') {
        void loadSessions();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedSession(null);
      return;
    }

    let active = true;

    const loadSession = async () => {
      try {
        const response = await fetchApi<SessionResponse>(`/api/sessions/${encodeURIComponent(selectedId)}`);
        if (active) {
          setSelectedSession(response.session);
        }
      } catch (loadError) {
        if (active) {
          setError(readError(loadError));
        }
      }
    };

    void loadSession();

    const unsubscribe = wsClient.subscribe((event) => {
      if (event === 'ready' || event === 'connected') {
        void loadSession();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [selectedId]);

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
          AC21
        </div>
        <h2 style={{ marginTop: 8, fontSize: 34, lineHeight: 1.05 }}>Sessions</h2>
        <p style={{ marginTop: 10, maxWidth: 740, color: '#475569', lineHeight: 1.7 }}>
          Session inventory from reef&apos;s local <code>/api/sessions</code> index, populated by reef-local
          cold-scan of provider session shards.
        </p>
      </header>

      {error ? (
        <div className="error-banner">{error}</div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        <section className="panel" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Agent</th>
                <th>Provider</th>
                <th>State</th>
                <th>Provenance</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.sessionId}
                  onClick={() => {
                    setSelectedId(session.sessionId);
                  }}
                  style={{
                    cursor: 'pointer',
                    background: session.sessionId === selectedId ? 'rgba(191, 219, 254, 0.35)' : undefined,
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{session.name ?? truncateId(session.sessionId)}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>{truncateId(session.sessionId)}</div>
                  </td>
                  <td>{session.agentName ?? 'n/a'}</td>
                  <td>{session.provider ?? 'n/a'}</td>
                  <td>{session.state ?? 'n/a'}</td>
                  <td>{session.provenanceState}</td>
                  <td>{formatDateTime(session.lastUsedAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && sessions.length === 0 ? (
            <div style={{ marginTop: 16, color: '#64748b' }}>No sessions indexed yet.</div>
          ) : null}
        </section>

        <section className="panel" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div>
            <h3 style={{ fontSize: 20 }}>Session Detail</h3>
            <p style={{ marginTop: 6, color: '#64748b' }}>
              {selectedSession ? 'Loaded from /api/sessions/:sessionId' : 'Select a session from the table.'}
            </p>
          </div>

          {selectedSession ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <DetailRow label="Session ID" value={selectedSession.sessionId} />
              <DetailRow label="Provider" value={displaySessionValue(selectedSession.provider)} />
              <DetailRow label="Name" value={displaySessionValue(selectedSession.name)} />
              <DetailRow label="Agent" value={displaySessionValue(selectedSession.agentName)} />
              <DetailRow label="State" value={displaySessionValue(selectedSession.state)} />
              <DetailRow label="Model" value={displaySessionValue(selectedSession.model)} />
              <DetailRow label="Working Directory" value={displaySessionValue(selectedSession.cwd)} />
              <DetailRow label="Project Root" value={displaySessionValue(selectedSession.projectRoot)} />
              <DetailRow label="Backend Namespace" value={displaySessionValue(selectedSession.backendNamespace)} />
              {selectedSession.shardHash ? <DetailRow label="Shard Hash" value={selectedSession.shardHash} /> : null}
              <DetailRow label="Provenance" value={selectedSession.provenanceState} />
              <DetailRow label="Created" value={formatDateTime(selectedSession.createdAt ?? null)} />
              <DetailRow label="Last Used" value={formatDateTime(selectedSession.lastUsedAt ?? null)} />
              <DetailRow label="Active Job" value={displaySessionValue(selectedSession.activeJobId)} />
              <DetailRow label="Last Job" value={displaySessionValue(selectedSession.lastJobId)} />
            </div>
          ) : (
            <div style={{ color: '#64748b' }}>No session selected.</div>
          )}
        </section>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <article
      style={{
        padding: '12px 14px',
        borderRadius: 14,
        background: '#ffffff',
        border: '1px solid rgba(15, 23, 42, 0.08)',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748b' }}>
        {label}
      </div>
      <div style={{ marginTop: 8, lineHeight: 1.6, wordBreak: 'break-word' }}>{value}</div>
    </article>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function displaySessionValue(value: string | undefined): string {
  return value ?? 'n/a';
}
