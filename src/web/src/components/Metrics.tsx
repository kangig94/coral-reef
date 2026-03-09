import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchApi } from '../api/client';
import { formatCurrency, formatInteger, formatPercent } from '../format';
import type { DailyMetric, MetricsSummary } from '../types';

type MetricsResponse = {
  range: {
    from: string | null;
    to: string | null;
  };
  metrics: DailyMetric[];
  summary: MetricsSummary;
};

type ChartDatum = {
  date: string;
  jobCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export function Metrics() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [summary, setSummary] = useState<MetricsSummary>({
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    jobCount: 0,
    successCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = async (nextFrom: string, nextTo: string) => {
    const search = new URLSearchParams();
    if (nextFrom) {
      search.set('from', nextFrom);
    }

    if (nextTo) {
      search.set('to', nextTo);
    }

    const path = search.size > 0 ? `/api/metrics?${search.toString()}` : '/api/metrics';

    try {
      const response = await fetchApi<MetricsResponse>(path);
      setMetrics(response.metrics);
      setSummary(response.summary);
      setError(null);
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMetrics('', '');
  }, []);

  const chartData = aggregateByDate(metrics);

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
          AC24
        </div>
        <h2 style={{ marginTop: 8, fontSize: 34, lineHeight: 1.05 }}>Metrics Dashboard</h2>
        <p style={{ marginTop: 10, maxWidth: 740, color: '#475569', lineHeight: 1.7 }}>
          Daily job counts, token usage, and cost from <code>/api/metrics</code>, aggregated across project roots for the charts below.
        </p>
      </header>

      <section className="panel" style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <h3 style={{ fontSize: 20 }}>Filters</h3>
            <p style={{ marginTop: 6, color: '#64748b' }}>Optional ISO date range. Leave blank to query all rows.</p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, color: '#475569' }}>From</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, color: '#475569' }}>To</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <button type="button" onClick={() => void loadMetrics(from, to)}>
              Apply
            </button>
          </div>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <SummaryCard label="Jobs" value={formatInteger(summary.jobCount)} />
          <SummaryCard label="Success Rate" value={formatPercent(summary.successCount, summary.jobCount)} />
          <SummaryCard label="Input Tokens" value={formatInteger(summary.inputTokens)} />
          <SummaryCard label="Output Tokens" value={formatInteger(summary.outputTokens)} />
          <SummaryCard label="Cost" value={formatCurrency(summary.costUsd)} />
        </div>
      </section>

      <section className="panel" style={{ display: 'grid', gap: 18 }}>
        <div>
          <h3 style={{ fontSize: 20 }}>Daily Job Volume</h3>
          <p style={{ marginTop: 6, color: '#64748b' }}>
            {loading ? 'Loading metrics...' : `${chartData.length} daily buckets`}
          </p>
        </div>

        {chartData.length === 0 ? (
          <div style={{ color: '#64748b' }}>No metric rows matched the current filter.</div>
        ) : (
          <>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="jobCount" fill="#1d4ed8" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="inputTokens" stackId="tokens" fill="#0f766e" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="outputTokens" stackId="tokens" fill="#f97316" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

function aggregateByDate(metrics: DailyMetric[]): ChartDatum[] {
  const grouped = new Map<string, ChartDatum>();

  for (const metric of metrics) {
    const current = grouped.get(metric.date) ?? {
      date: metric.date,
      jobCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    current.jobCount += metric.jobCount;
    current.inputTokens += metric.inputTokens;
    current.outputTokens += metric.outputTokens;
    current.costUsd += metric.costUsd;
    grouped.set(metric.date, current);
  }

  return [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article
      style={{
        padding: '16px 18px',
        borderRadius: 18,
        background: '#ffffff',
        border: '1px solid rgba(15, 23, 42, 0.08)',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748b' }}>
        {label}
      </div>
      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </article>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
