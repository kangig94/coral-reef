import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchApi } from '../api/client';
import { wsClient } from '../api/ws';
import {
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatInteger,
  prettyJson,
  truncateId,
} from '../format';
import type { Job, ProgressEvent } from '../types';

type JobDetailResponse = {
  job: Job;
  events: ProgressEvent[];
};

export function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setError('Missing job id');
      setLoading(false);
      return;
    }

    let active = true;

    const loadJob = async () => {
      try {
        const response = await fetchApi<JobDetailResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (!active) {
          return;
        }

        setJob(response.job);
        setEvents(response.events);
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

    void loadJob();
    wsClient.connect();

    const unsubscribe = wsClient.subscribe((event, data) => {
      const liveJobId = typeof data.jobId === 'string' ? data.jobId : null;
      if (event === 'connected' || event === 'ready' || liveJobId === jobId) {
        void loadJob();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [jobId]);

  if (loading) {
    return <Panel title="Job Detail" subtitle="Loading job detail..." />;
  }

  if (error || !job) {
    return (
      <Panel title="Job Detail" subtitle={error ?? 'Job not found'}>
        <Link to="/" style={{ color: '#1d4ed8', fontWeight: 600 }}>
          Back to jobs
        </Link>
      </Panel>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
            AC20
          </div>
          <h2 style={{ marginTop: 8, fontSize: 34, lineHeight: 1.05 }}>{truncateId(job.jobId)}</h2>
          <p style={{ marginTop: 10, color: '#475569', lineHeight: 1.7, maxWidth: 700 }}>
            Full job metadata, terminal result, usage, and the persisted event timeline from <code>/api/jobs/:jobId</code>.
          </p>
        </div>

        <Link
          to="/"
          style={{
            alignSelf: 'flex-start',
            textDecoration: 'none',
            color: '#0f172a',
            background: '#ffffff',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            borderRadius: 14,
            padding: '12px 14px',
            fontWeight: 600,
          }}
        >
          Back to board
        </Link>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <MetricCard label="Phase" value={job.phase} />
        <MetricCard label="Provider" value={job.provider} />
        <MetricCard label="Session" value={truncateId(job.sessionId)} />
        <MetricCard label="Workflow Kind" value={job.jobKind ?? 'n/a'} />
        <MetricCard label="Launch State" value={job.launchState ?? 'n/a'} />
        <MetricCard label="Duration" value={formatDuration(job.durationMs)} />
        <MetricCard label="Cost" value={formatCurrency(job.costUsd)} />
        <MetricCard label="Input Tokens" value={formatInteger(job.inputTokens)} />
        <MetricCard label="Output Tokens" value={formatInteger(job.outputTokens)} />
        <MetricCard label="Created" value={formatDateTime(job.createdAt)} />
        <MetricCard label="Completed" value={formatDateTime(job.completedAt)} />
        <MetricCard label="Project Root" value={job.projectRoot} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        <Panel title="Progress Timeline" subtitle={`${events.length} stored events`}>
          {events.length === 0 ? (
            <div style={{ color: '#64748b' }}>No progress events recorded for this job.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {events.map((event) => (
                <article
                  key={event.id}
                  style={{
                    padding: '14px',
                    borderRadius: 16,
                    border: '1px solid rgba(15, 23, 42, 0.08)',
                    background: '#ffffff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <strong>{event.message ?? event.type}</strong>
                    <span style={{ color: '#64748b', fontSize: 13 }}>
                      #{event.eventId} · {formatDateTime(event.ts)}
                    </span>
                  </div>
                  {event.payload ? (
                    <pre
                      style={{
                        marginTop: 10,
                        padding: '12px',
                        borderRadius: 14,
                        background: '#f8fafc',
                        color: '#334155',
                        overflowX: 'auto',
                        fontSize: 12,
                        lineHeight: 1.55,
                      }}
                    >
                      {prettyJson(event.payload)}
                    </pre>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Terminal Result" subtitle={job.result ? 'Persisted JSON result' : 'No result stored yet'}>
          <pre
            style={{
              padding: '14px',
              borderRadius: 16,
              background: '#0f172a',
              color: '#e2e8f0',
              overflowX: 'auto',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {prettyJson(job.result)}
          </pre>
        </Panel>
      </div>
    </section>
  );
}

function Panel(
  { title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode },
) {
  return (
    <section
      style={{
        padding: 20,
        borderRadius: 22,
        background: 'rgba(255, 255, 255, 0.84)',
        border: '1px solid rgba(15, 23, 42, 0.08)',
        boxShadow: '0 20px 40px rgba(15, 23, 42, 0.08)',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 20 }}>{title}</h3>
        <p style={{ marginTop: 6, color: '#64748b' }}>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article
      style={{
        padding: '16px 18px',
        borderRadius: 18,
        background: 'rgba(255, 255, 255, 0.82)',
        border: '1px solid rgba(15, 23, 42, 0.08)',
      }}
    >
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b' }}>
        {label}
      </div>
      <div style={{ marginTop: 10, fontSize: 18, lineHeight: 1.4 }}>{value}</div>
    </article>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
