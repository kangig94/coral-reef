export type JobPhase = 'queued' | 'launching' | 'running' | 'completed' | 'error' | 'aborted';

export type Job = {
  jobId: string;
  sessionId: string;
  provider: string;
  projectRoot: string;
  phase: JobPhase;
  launchState: string | null;
  createdAt: string | null;
  completedAt: string | null;
  result: string | null;
  jobKind: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
};

export type ProgressEvent = {
  id: number;
  jobId: string;
  eventId: number;
  type: string;
  ts: string | null;
  message: string | null;
  payload: string | null;
};

export type Session = {
  sessionId: string;
  provider: string;
  name: string;
  state: string;
  model: string;
  cwd: string;
  projectRoot: string | null;
  shardHash: string;
  provenanceState: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  version: number;
  activeJobId: string | null;
  lastJobId: string | null;
};

export type DiscussSession = {
  sessionId: string;
  topic: string;
  projectRoot: string;
  status: string;
  sessionDir: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  stateJson: string | null;
};

export type TranscriptEntry = {
  id: number;
  discussSessionId: string;
  seq: number;
  kind: string;
  agent: string | null;
  content: string | null;
  epoch: number | null;
  round: number | null;
  ts: string | null;
  payload: string | null;
};

export type DailyMetric = {
  date: string;
  projectRoot: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  jobCount: number;
  successCount: number;
};

export type MetricsSummary = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  jobCount: number;
  successCount: number;
};

export type ChatResponse = {
  sessionId: string | null;
  reply: string;
  receivedAt: string;
  stub: boolean;
};
