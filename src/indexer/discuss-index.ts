import type Database from 'better-sqlite3';
import type { DiscussDetailResponse } from 'coral/client';
import { toDiscussReefId } from './source-ids.js';

export type DiscussUpsertContext = {
  connectionId: string;
  projectRoot: string;
  originDiscussSessionId: string;
  sessionDir?: string | null;
};

export type UpsertDiscussResult = {
  sessionId: string;
  originDiscussSessionId: string;
  lastSeq: number;
  status: string;
};

type DiscussSessionProjection = {
  topic: string;
  status: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  stateJson: string;
};

type DiscussTranscriptEntry = DiscussDetailResponse['transcript'][number];

type TranscriptRow = {
  seq: number;
  kind: string;
  agent: string | null;
  content: string | null;
  epoch: number | null;
  round: number | null;
  ts: string | null;
  payload: string;
};

export function upsertDiscussDetail(
  db: Database.Database,
  detail: DiscussDetailResponse,
  context: DiscussUpsertContext,
): UpsertDiscussResult {
  const sessionId = toDiscussReefId(context);
  const sessionRow = mapDiscussSessionRow(detail);
  const transcriptRows = mapDiscussTranscriptRows(detail);

  const insertDiscuss = db.prepare(`
    INSERT OR REPLACE INTO discuss_sessions (
      sessionId, topic, projectRoot, status, sessionDir, createdAt, lastActivityAt, stateJson,
      connectionId, originDiscussSessionId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectExisting = db.prepare(`
    SELECT sessionDir
    FROM discuss_sessions
    WHERE sessionId = ?
  `);
  const deleteDiscuss = db.prepare('DELETE FROM discuss_sessions WHERE sessionId = ?');
  const deleteTranscript = db.prepare('DELETE FROM transcript_entries WHERE discussSessionId = ?');
  const insertTranscript = db.prepare(`
    INSERT INTO transcript_entries (
      discussSessionId, seq, kind, agent, content, epoch, round, ts, payload
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((): void => {
    const existing = selectExisting.get(sessionId) as { sessionDir: string } | undefined;
    const sessionDir = context.sessionDir ?? existing?.sessionDir ?? '';

    if (context.connectionId === 'local:auto' && sessionId !== context.originDiscussSessionId) {
      deleteTranscript.run(context.originDiscussSessionId);
      deleteDiscuss.run(context.originDiscussSessionId);
    }

    insertDiscuss.run(
      sessionId,
      sessionRow.topic,
      context.projectRoot,
      sessionRow.status,
      sessionDir,
      sessionRow.createdAt,
      sessionRow.lastActivityAt,
      sessionRow.stateJson,
      context.connectionId,
      context.originDiscussSessionId,
    );

    deleteTranscript.run(sessionId);
    for (const row of transcriptRows) {
      insertTranscript.run(
        sessionId,
        row.seq,
        row.kind,
        row.agent,
        row.content,
        row.epoch,
        row.round,
        row.ts,
        row.payload,
      );
    }
  });

  transaction();

  return {
    sessionId,
    originDiscussSessionId: context.originDiscussSessionId,
    lastSeq: detail.lastSeq,
    status: detail.session.status,
  };
}

export function mapDiscussSessionRow(detail: DiscussDetailResponse): DiscussSessionProjection {
  return {
    topic: detail.session.topic,
    status: detail.session.status,
    createdAt: detail.session.createdAt,
    lastActivityAt: detail.session.lastActivityAt,
    stateJson: JSON.stringify(detail.session),
  };
}

export function mapDiscussTranscriptRows(detail: DiscussDetailResponse): TranscriptRow[] {
  return detail.transcript.map((entry, index) => mapDiscussTranscriptRow(entry, index + 1));
}

function mapDiscussTranscriptRow(entry: DiscussTranscriptEntry, seq: number): TranscriptRow {
  const payload = JSON.stringify(entry);

  switch (entry.type) {
    case 'speech':
      return {
        seq,
        kind: entry.type,
        agent: entry.agent,
        content: entry.content,
        epoch: entry.epoch,
        round: entry.step,
        ts: entry.ts,
        payload,
      };

    case 'follow_up':
      return {
        seq,
        kind: entry.type,
        agent: entry.agent,
        content: `Q: ${entry.question}\nA: ${entry.answer}`,
        epoch: entry.epoch,
        round: null,
        ts: entry.ts,
        payload,
      };

    case 'epoch_summary':
      return {
        seq,
        kind: entry.type,
        agent: null,
        content: entry.summary,
        epoch: entry.epoch,
        round: null,
        ts: entry.ts,
        payload,
      };

    case 'session_event':
      return {
        seq,
        kind: entry.type,
        agent: null,
        content: entry.detail,
        epoch: entry.epoch,
        round: null,
        ts: entry.ts,
        payload,
      };

    case 'bids':
      return {
        seq,
        kind: entry.type,
        agent: entry.winner,
        content: null,
        epoch: entry.epoch,
        round: entry.step,
        ts: entry.ts,
        payload,
      };
  }
}
