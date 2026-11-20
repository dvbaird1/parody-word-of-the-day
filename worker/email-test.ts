import { z } from 'zod';
import { normalizeEmail, type EmailTest, type Word } from '../shared/model';
import { graphAccessToken, submitGraphTest, type GraphConfig } from './graph';
import { HttpError } from './http';
import { previewProvider } from './preview';

export type EmailTestBindings = {
  GRAPH_TENANT_ID?: string;
  GRAPH_CLIENT_ID?: string;
  GRAPH_CLIENT_SECRET?: string;
  GRAPH_MAILBOX?: string;
  GRAPH_TEST_RECIPIENT?: string;
  UNSUBSCRIBE_LINKS?: { createLink(id: string): Promise<string> };
};

const configSchema = z.object({
  tenantId: z.uuid(), clientId: z.uuid(), clientSecret: z.string().min(1),
  mailbox: z.email(), recipient: z.email(),
});

function graphConfig(env: EmailTestBindings): GraphConfig | undefined {
  return configSchema.safeParse({
    tenantId: env.GRAPH_TENANT_ID, clientId: env.GRAPH_CLIENT_ID, clientSecret: env.GRAPH_CLIENT_SECRET,
    mailbox: env.GRAPH_MAILBOX, recipient: env.GRAPH_TEST_RECIPIENT && normalizeEmail(env.GRAPH_TEST_RECIPIENT),
  }).data;
}

export async function emailTestStatus(db: D1Database, env: EmailTestBindings): Promise<EmailTest> {
  const recipient = normalizeEmail(env.GRAPH_TEST_RECIPIENT ?? '') || null;
  const configured = Boolean(graphConfig(env) && env.UNSUBSCRIBE_LINKS);
  const status = configured
    ? await db.prepare('SELECT status FROM email_test_sends WHERE recipient_email=?').bind(recipient).first<EmailTest['status']>('status')
    : null;
  return {recipient, configured, status};
}

export async function sendEmailTest(db: D1Database, env: EmailTestBindings, word: Word, actor: string): Promise<EmailTest> {
  const config = graphConfig(env);
  const signer = env.UNSUBSCRIBE_LINKS;
  if (!config || !signer) throw new HttpError(503, 'The Graph test sender is not configured.');
  if (word.status !== 'approved') throw new HttpError(409, 'Select an approved word for the test.');

  const attempt = crypto.randomUUID();
  const now = new Date().toISOString();
  const claim = await db.prepare(`INSERT INTO email_test_sends VALUES (?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(recipient_email) DO UPDATE SET attempt_id=excluded.attempt_id, word_id=excluded.word_id,
      actor=excluded.actor, status='pending', started_at=excluded.started_at, updated_at=excluded.updated_at
    WHERE email_test_sends.status='failed'`).bind(config.recipient, attempt, word.id, actor, now, now).run();
  if (claim.meta.changes !== 1) throw new HttpError(409, 'A test has already been submitted or its outcome needs verification.');

  const finish = async (status: NonNullable<EmailTest['status']>) => {
    const result = await db.prepare(`UPDATE email_test_sends SET status=?, updated_at=?
      WHERE recipient_email=? AND attempt_id=? AND status='pending'`)
      .bind(status, new Date().toISOString(), config.recipient, attempt).run();
    if (result.meta.changes !== 1) throw new Error('Could not record the Graph test outcome');
  };

  let email, accessToken: string;
  try {
    accessToken = await graphAccessToken(config);
    // An explicit test destination can receive one test without joining the daily list.
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

  const status = await submitGraphTest(config, accessToken, email);
  await finish(status);
  return {recipient: config.recipient, configured: true, status};
}
