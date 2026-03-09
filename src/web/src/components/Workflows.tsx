import { useEffect, useState } from 'react';
import { fetchApi } from '../api/client';
import { wsClient } from '../api/ws';
import { formatDateTime, formatDuration, truncateId } from '../format';
import type { Job, ProgressEvent } from '../types';

type WorkflowsResponse = {
  workflows: Job[];
};

type WorkflowDetailResponse = {
  job: Job;
  events: ProgressEvent[];
};

export function Workflows() {
  const [workflows, setWorkflows] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Job | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadWorkflows = async () => {
      try {
        const response = await fetchApi<WorkflowsResponse>('/api/workflows');
        if (!active) {
          return;
        }

        setWorkflows(response.workflows);
        setSelectedJobId((current) => current ?? response.workflows[0]?.jobId ?? null);
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

    void loadWorkflows();
    wsClient.connect();

    const unsubscribe = wsClient.subscribe((event) => {
      if (event === 'connected' || event === 'ready' || event.startsWith('job:')) {
        void loadWorkflows();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedWorkflow(null);
      setEvents([]);
      return;
    }

    let active = true;

    const loadWorkflowDetail = async () => {
      try {
        const response = await fetchApi<WorkflowDetailResponse>(`/api/jobs/${encodeURIComponent(selectedJobId)}`);
        if (!active) {
          return;
        }

        setSelectedWorkflow(response.job);
        setEvents(response.events);
        setError(null);
      } catch (loadError) {
        if (active) {
          setError(readError(loadError));
        }
      }
    };

    void loadWorkflowDetail();

    const unsubscribe = wsClient.subscribe((event, data) => {
      const liveJobId = typeof data.jobId === 'string' ? data.jobId : null;
      if (event === 'connected' || event === 'ready' || liveJobId === selectedJobId) {
        void loadWorkflowDetail();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [selectedJobId]);

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
          AC23
        </div>
        <h2 style={{ marginTop: 8, fontSize: 34, lineHeight: 1.05 }}>Workflow Visualization</h2>
        <p style={{ marginTop: 10, maxWidth: 740, color: '#475569', lineHeight: 1.7 }}>
          Workflow jobs are listed from <code>/api/workflows</code>, with step-by-step progress inferred from the stored event stream.
        </p>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        <section className="panel" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div>
            <h3 style={{ fontSize: 20 }}>Workflow Jobs</h3>
            <p style={{ marginTop: 6, color: '#64748b' }}>
              {loading ? 'Loading workflows...' : `${workflows.length} workflow jobs`}
            </p>
          </div>

          {workflows.map((workflow) => (
            <button
              key={workflow.jobId}
              type="button"
              onClick={() => {
                setSelectedJobId(workflow.jobId);
              }}
              style={{
                textAlign: 'left',
                padding: '14px',
                borderRadius: 16,
                border: workflow.jobId === selectedJobId
                  ? '1px solid rgba(29, 78, 216, 0.28)'
                  : '1px solid rgba(15, 23, 42, 0.08)',
                background: workflow.jobId === selectedJobId
                  ? 'rgba(219, 234, 254, 0.52)'
                  : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <strong>{truncateId(workflow.jobId)}</strong>
              <div style={{ marginTop: 8, color: '#475569', fontSize: 13, lineHeight: 1.6 }}>
                <div>Phase: {workflow.phase}</div>
                <div>Provider: {workflow.provider}</div>
                <div>Duration: {formatDuration(workflow.durationMs)}</div>
                <div>Created: {formatDateTime(workflow.createdAt)}</div>
              </div>
            </button>
          ))}

          {!loading && workflows.length === 0 ? (
            <div style={{ color: '#64748b' }}>No workflow jobs found.</div>
          ) : null}
        </section>

        <section className="panel" style={{ display: 'grid', gap: 16 }}>
          {selectedWorkflow ? (
            <>
              <div>
                <h3 style={{ fontSize: 20 }}>{truncateId(selectedWorkflow.jobId)}</h3>
                <p style={{ marginTop: 6, color: '#64748b' }}>
                  {selectedWorkflow.phase} · {selectedWorkflow.provider} · {formatDuration(selectedWorkflow.durationMs)}
                </p>
              </div>

              {events.length === 0 ? (
                <div style={{ color: '#64748b' }}>No workflow events stored yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {events.map((event, index) => (
                    <article
                      key={event.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '42px minmax(0, 1fr)',
                        gap: 14,
                        alignItems: 'start',
                      }}
                    >
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 999,
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 700,
                          color: '#eff6ff',
                          background: 'linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%)',
                        }}
                      >
                        {index + 1}
                      </div>
                      <div
                        style={{
                          padding: '14px',
                          borderRadius: 16,
                          background: '#ffffff',
                          border: '1px solid rgba(15, 23, 42, 0.08)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <strong>{event.message ?? event.type}</strong>
                          <span className="pill">{formatDateTime(event.ts)}</span>
                        </div>
                        {event.payload ? (
                          <pre
                            style={{
                              marginTop: 10,
                              padding: '12px',
                              borderRadius: 14,
                              background: '#f8fafc',
                              overflowX: 'auto',
                              fontSize: 12,
                              lineHeight: 1.6,
                            }}
                          >
                            {event.payload}
                          </pre>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#64748b' }}>Select a workflow job to inspect its pipeline progress.</div>
          )}
        </section>
      </div>
    </section>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
