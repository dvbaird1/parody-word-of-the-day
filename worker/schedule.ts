import { z } from 'zod';
import type { Settings, Word } from '../shared/model';
import { queueOrder } from './data';
import { graphAccessToken, graphSender, submitGraphEmail, type GraphBindings } from './graph';
import { previewProvider } from './preview';

type ScheduleEnv = GraphBindings & { DB: D1Database };
type Run = {id: string; word_id: string; status: string};
const eastern = 'America/New_York';
const minute = 60_000;
const batchSize = 5;
const eligible = `r.status='active' AND r.unsubscribed_at IS NULL
  AND length(trim(r.consent_source)) > 0 AND r.consented_at <= ?`;

function clock(time: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(time);
  const {year, month, day, hour, minute: minutes} = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {date: `${year}-${month}-${day}`, time: `${hour}:${minutes}`};
}

// Crossing the wall-clock time also covers spring-forward times that never occur.
export function scheduleDue(time: number, timezone: string, sendTime: string) {
  const current = clock(time, timezone);
  if (current.time < sendTime) return false;
  const before = clock(time - 15 * minute, timezone);
  return current.time === sendTime || before.date !== current.date || before.time < sendTime;
}

async function finishRun(db: D1Database, id: string) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE send_runs SET completed_at=?,
      status=CASE WHEN EXISTS (SELECT 1 FROM send_deliveries d WHERE d.run_id=? AND d.status IN ('failed','unknown'))
                  THEN 'failed' ELSE 'completed' END
      WHERE id=? AND status='running'
        AND NOT EXISTS (SELECT 1 FROM send_deliveries d WHERE d.run_id=? AND d.status IN ('pending','submitting'))`)
      .bind(now, id, id, id),
    db.prepare(`UPDATE words SET status='sent', sent_at=?, updated_at=?
      WHERE status<>'sent' AND id=(SELECT word_id FROM send_runs WHERE id=? AND completed_at IS NOT NULL)
        AND EXISTS (SELECT 1 FROM send_deliveries WHERE run_id=? AND status IN ('submitted_to_graph','unknown'))`)
      .bind(now, now, id, id),
  ]);
}

async function recoverRuns(db: D1Database, date: string) {
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 2 * minute).toISOString();
  await db.batch([
    db.prepare(`UPDATE send_deliveries SET status='unknown', updated_at=?
      WHERE status='submitting' AND updated_at < ?`).bind(now, stale),
    db.prepare(`UPDATE send_deliveries SET status='failed', updated_at=? WHERE status='pending'
      AND run_id IN (SELECT id FROM send_runs WHERE status='running' AND schedule_date_et < ?)`).bind(now, date),
  ]);
  const old = await db.prepare("SELECT id FROM send_runs WHERE status='running' AND schedule_date_et < ? LIMIT 10")
    .bind(date).all<{id: string}>();
  for (const run of old.results) await finishRun(db, run.id);
}

async function reserveRun(db: D1Database, date: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO send_runs (id,schedule_date_et,word_id,status,created_at,started_at)
      SELECT ?, ?, w.id, 'running', ?, ? FROM words w WHERE w.status='approved'
        AND EXISTS (SELECT 1 FROM recipients r WHERE ${eligible})
        AND EXISTS (SELECT 1 FROM app_settings WHERE id=1 AND sending_enabled=1)
        AND NOT EXISTS (
          SELECT 1 FROM send_runs previous WHERE previous.word_id=w.id AND (
            previous.status IN ('pending','running') OR EXISTS (
              SELECT 1 FROM send_deliveries d WHERE d.run_id=previous.id
                AND d.status IN ('submitting','submitted_to_graph','unknown')
            )
          )
        )
      ORDER BY ${queueOrder} LIMIT 1 ON CONFLICT(schedule_date_et) DO NOTHING`)
      .bind(id, date, now, now, date),
    db.prepare(`INSERT INTO send_deliveries (run_id,recipient_id,status,created_at,updated_at)
      SELECT ?, r.id, 'pending', ?, ? FROM recipients r WHERE ${eligible}
        AND EXISTS (SELECT 1 FROM send_runs WHERE id=?)`).bind(id, now, now, date, id),
  ]);
}

export async function runScheduledDelivery(time: number, env: ScheduleEnv) {
  const db = env.DB;
  const settings = await db.prepare('SELECT timezone,send_time,sending_enabled FROM app_settings WHERE id=1').first<Settings>();
  if (!settings?.sending_enabled) return;
  const sender = graphSender(env);
  const signer = env.UNSUBSCRIBE_LINKS;
  if (!sender || !signer) return;

  const date = clock(time, eastern).date;
  const lookup = () => db.prepare('SELECT id,word_id,status FROM send_runs WHERE schedule_date_et=?').bind(date).first<Run>();
  let run = await lookup();
  if (run ? run.status !== 'running' : !scheduleDue(time, settings.timezone, settings.send_time)) return;
  await recoverRuns(db, date);
  if (!run) {
    await reserveRun(db, date);
    run = await lookup();
  }
  if (!run || run.status !== 'running') return;

  await db.prepare(`UPDATE send_deliveries SET status='suppressed', updated_at=? WHERE run_id=? AND status='pending'
    AND NOT EXISTS (SELECT 1 FROM recipients r WHERE r.id=send_deliveries.recipient_id AND ${eligible})`)
    .bind(new Date().toISOString(), run.id, date).run();
  const word = await db.prepare('SELECT * FROM words WHERE id=?').bind(run.word_id).first<Word>();
  if (!word || word.status !== 'approved') {
    await db.prepare("UPDATE send_deliveries SET status='failed', updated_at=? WHERE run_id=? AND status='pending'")
      .bind(new Date().toISOString(), run.id).run();
    await finishRun(db, run.id);
    return;
  }
  const pending = await db.prepare(`SELECT d.recipient_id, r.email_normalized AS recipient FROM send_deliveries d
    JOIN recipients r ON r.id=d.recipient_id WHERE d.run_id=? AND d.status='pending' ORDER BY d.recipient_id LIMIT ?`)
    .bind(run.id, batchSize).all<{recipient_id: string; recipient: string}>();
  if (pending.results.length) {
    const token = await graphAccessToken(sender);
    for (const delivery of pending.results) {
      if (!z.email().safeParse(delivery.recipient).success) {
        await db.prepare("UPDATE send_deliveries SET status='failed', updated_at=? WHERE run_id=? AND recipient_id=? AND status='pending'")
          .bind(new Date().toISOString(), run.id, delivery.recipient_id).run();
        continue;
      }
      const link = new URL(await signer.createLink(delivery.recipient_id));
      const email = previewProvider.preview(word, undefined, link);
      // The conditional claim checks consent, opt-out, the pause switch, and the word just before Graph.
      const claim = await db.prepare(`UPDATE send_deliveries SET status='submitting', updated_at=?
        WHERE run_id=? AND recipient_id=? AND status='pending'
          AND EXISTS (SELECT 1 FROM app_settings WHERE id=1 AND sending_enabled=1)
          AND EXISTS (SELECT 1 FROM words WHERE id=? AND status='approved')
          AND EXISTS (SELECT 1 FROM recipients r WHERE r.id=? AND ${eligible})`)
        .bind(new Date().toISOString(), run.id, delivery.recipient_id, word.id, delivery.recipient_id, date).run();
      if (!claim.meta.changes) continue;
      const outcome = await submitGraphEmail({...sender, recipient: delivery.recipient}, token, email);
      await db.prepare(`UPDATE send_deliveries SET status=?, updated_at=?
        WHERE run_id=? AND recipient_id=? AND status='submitting'`)
        .bind(outcome, new Date().toISOString(), run.id, delivery.recipient_id).run();
    }
  }
  await finishRun(db, run.id);
}
