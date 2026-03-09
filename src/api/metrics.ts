import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { sendJson } from './router.js';

type DailyMetricRow = {
  date: string;
  projectRoot: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  jobCount: number;
  successCount: number;
};

export function handleMetrics(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/metrics') {
    return false;
  }

  const from = requestUrl.searchParams.get('from');
  const to = requestUrl.searchParams.get('to');

  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    sendJson(res, 400, { error: 'invalid_date_range' });
    return true;
  }

  if (from && to && from > to) {
    sendJson(res, 400, { error: 'invalid_date_range' });
    return true;
  }

  const clauses: string[] = [];
  const params: Array<string> = [];

  if (from) {
    clauses.push('date >= ?');
    params.push(from);
  }

  if (to) {
    clauses.push('date <= ?');
    params.push(to);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const metrics = db.prepare(`
    SELECT *
    FROM daily_metrics
    ${where}
    ORDER BY date DESC, projectRoot ASC
  `).all(...params) as DailyMetricRow[];

  const summary = metrics.reduce(
    (accumulator, row) => ({
      inputTokens: accumulator.inputTokens + row.inputTokens,
      outputTokens: accumulator.outputTokens + row.outputTokens,
      costUsd: accumulator.costUsd + row.costUsd,
      jobCount: accumulator.jobCount + row.jobCount,
      successCount: accumulator.successCount + row.successCount,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      jobCount: 0,
      successCount: 0,
    },
  );

  sendJson(res, 200, {
    range: {
      from: from ?? null,
      to: to ?? null,
    },
    metrics,
    summary,
  });
  return true;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
