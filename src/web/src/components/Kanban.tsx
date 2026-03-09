import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchApi } from '../api/client';
import { wsClient } from '../api/ws';
import { formatDateTime, formatDuration, truncateId } from '../format';
import type { Job, JobPhase } from '../types';

const PHASES: Array<{ phase: JobPhase; label: string; accent: string }> = [
  { phase: 'queued', label: 'Queued', accent: '#a855f7' },
  { phase: 'launching', label: 'Launching', accent: '#f59e0b' },
  { phase: 'running', label: 'Running', accent: '#2563eb' },
  { phase: 'completed', label: 'Completed', accent: '#16a34a' },
  { phase: 'error', label: 'Error', accent: '#dc2626' },
  { phase: 'aborted', label: 'Aborted', accent: '#64748b' },
];

export function Kanban() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadJobs = async () => {
      try {
        const response = await fetchApi<{ jobs: Job[] }>('/api/jobs');
        if (!active) {
          return;
        }

        setJobs(response.jobs);
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

    void loadJobs();
    wsClient.connect();

    const unsubscribe = wsClient.subscribe((event) => {
      if (event === 'connected' || event === 'ready' || event.startsWith('job:')) {
        void loadJobs();
      }
    });

    const interval = window.setInterval(() => {
      void loadJobs();
    }, 15000);

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(interval);
    };
  }, []);

  const groupedJobs = jobs.reduce<Record<JobPhase, Job[]>>(
    (accumulator, job) => {
      accumulator[job.phase].push(job);
      return accumulator;
    },
    {
      queued: [],
      launching: [],
      running: [],
      completed: [],
      error: [],
      aborted: [],
    },
  );

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-end',
        }}
      >
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
            AC19
          </div>
          <h2 style={{ marginTop: 8, fontSize: 34, lineHeight: 1.05 }}>Job Kanban</h2>
          <p style={{ marginTop: 10, maxWidth: 680, color: '#475569', lineHeight: 1.7 }}>
            Jobs are grouped by phase and refreshed from both the REST API and the live WebSocket relay.
          </p>
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderRadius: 16,
            background: 'rgba(255, 255, 255, 0.8)',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            minWidth: 180,
          }}
        >
          <div style={{ fontSize: 13, color: '#64748b' }}>Visible jobs</div>
          <div style={{ marginTop: 4, fontSize: 28, fontWeight: 700 }}>{jobs.length}</div>
          <div style={{ marginTop: 4, fontSize: 13, color: '#64748b' }}>
            {loading ? 'Loading...' : 'Live updates enabled'}
          </div>
        </div>
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {PHASES.map((column) => (
          <section
            key={column.phase}
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              borderRadius: 20,
              border: `1px solid ${column.accent}22`,
              background: 'rgba(255, 255, 255, 0.82)',
              minHeight: 300,
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>{column.label}</h3>
                <div style={{ marginTop: 4, color: column.accent, fontSize: 13 }}>
                  {groupedJobs[column.phase].length} jobs
                </div>
              </div>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: column.accent,
                  boxShadow: `0 0 0 5px ${column.accent}1a`,
                }}
              />
            </header>

            {groupedJobs[column.phase].length === 0 ? (
              <div
                style={{
                  padding: '18px 14px',
                  borderRadius: 16,
                  background: '#f8fafc',
                  color: '#64748b',
                  lineHeight: 1.6,
                }}
              >
                {loading ? 'Loading jobs...' : 'No jobs in this phase.'}
              </div>
            ) : (
              groupedJobs[column.phase].map((job) => (
                <Link
                  key={job.jobId}
                  to={`/jobs/${encodeURIComponent(job.jobId)}`}
                  style={{
                    display: 'grid',
                    gap: 10,
                    padding: '14px',
                    borderRadius: 18,
                    textDecoration: 'none',
                    color: '#0f172a',
                    background: '#ffffff',
                    border: '1px solid rgba(15, 23, 42, 0.08)',
                    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <strong style={{ fontSize: 14 }}>{truncateId(job.jobId)}</strong>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: 999,
                        fontSize: 12,
                        background: `${column.accent}14`,
                        color: column.accent,
                        textTransform: 'capitalize',
                      }}
                    >
                      {job.phase}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#475569' }}>
                    <div>Provider: {job.provider}</div>
                    <div>Duration: {formatDuration(job.durationMs)}</div>
                    <div>Created: {formatDateTime(job.createdAt)}</div>
                    <div>Launch: {job.launchState ?? 'n/a'}</div>
                  </div>
                </Link>
              ))
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 16,
        border: '1px solid rgba(220, 38, 38, 0.18)',
        background: 'rgba(254, 242, 242, 0.95)',
        color: '#991b1b',
      }}
    >
      {message}
    </div>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
