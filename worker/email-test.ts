import type { EmailTest, Word } from '../shared/model';
import { graphAccessToken, graphSender, submitGraphEmail, type GraphBindings } from './graph';
import { HttpError } from './http';
import { previewProvider } from './preview';

export function emailTestConfigured(env: GraphBindings) {
  return Boolean(graphSender(env) && env.UNSUBSCRIBE_LINKS);
}

export async function sendEmailTest(
  db: D1Database, env: GraphBindings, word: Word, actor: string, recipientEmail: string, attempt: string,
): Promise<EmailTest> {
  const sender = graphSender(env);
  const signer = env.UNSUBSCRIBE_LINKS;
  if (!sender || !signer) throw new HttpError(503, 'The Graph test sender is not configured.');
  if (word.status !== 'approved') throw new HttpError(409, 'Select an approved word for the test.');
  const config = {...sender, recipient: recipientEmail};

  const now = new Date().toISOString();
  const claim = await db.prepare(`INSERT INTO email_test_sends (attempt_id,recipient_email,word_id,actor,status,started_at,updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT DO NOTHING`).bind(attempt, recipientEmail, word.id, actor, now, now).run();
  if (!claim.meta.changes) {
    const previous = await db.prepare(`SELECT status FROM email_test_sends
      WHERE attempt_id=? AND recipient_email=? AND word_id=? AND actor=?`)
      .bind(attempt, recipientEmail, word.id, actor).first<EmailTest['status']>('status');
    if (previous) return {recipient: recipientEmail, status: previous};
    throw new HttpError(409, 'This address has a test in progress or an uncertain outcome. Check the inbox before sending again.');
  }

  const finish = async (status: EmailTest['status']) => {
    const result = await db.prepare(`UPDATE email_test_sends SET status=?, updated_at=?
      WHERE recipient_email=? AND attempt_id=? AND status='pending'`)
      .bind(status, new Date().toISOString(), config.recipient, attempt).run();
    if (result.meta.changes !== 1) throw new Error('Could not record the Graph test outcome');
  };

  let email, accessToken: string;
  try {
    accessToken = await graphAccessToken(config);
    // A test destination stays outside the daily list unless it already opted in.
    await db.prepare(`INSERT INTO recipients (id,email,email_normalized,status,created_at,updated_at)
      VALUES (?,?,?,'inactive',?,?) ON CONFLICT(email_normalized) DO NOTHING`)
      .bind(crypto.randomUUID(), config.recipient, config.recipient, now, now).run();
    const recipient = await db.prepare(`SELECT id FROM recipients WHERE email_normalized=?
      AND status IN ('active','inactive') AND unsubscribed_at IS NULL`).bind(config.recipient).first<string>('id');
    if (!recipient) throw new HttpError(409, 'The test address is unsubscribed or suppressed.');
    const link = new URL(await signer.createLink(recipient));
    email = previewProvider.preview(word, `[Test] Word of the Day · ${word.term}`, link);
    const eligible = await db.prepare(`SELECT 1 AS eligible FROM recipients WHERE id=?
      AND status IN ('active','inactive') AND unsubscribed_at IS NULL`).bind(recipient).first<number>('eligible');
    if (!eligible) throw new HttpError(409, 'The test address is unsubscribed or suppressed.');
  } catch (error) {
    await finish('failed');
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'Could not prepare the email test. Check the Graph credential and unsubscribe signer before retrying.');
  }

  const status = await submitGraphEmail(config, accessToken, email);
  await finish(status);
  return {recipient: config.recipient, status};
}
