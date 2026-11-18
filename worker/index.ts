import { z } from 'zod';
import {
  normalizeTerm, recipientInput, recipientPatch, recipientStatus, settingsInput, wordInput, wordPatch, wordStatus,
  type Dashboard, type Page, type Recipient, type SendRun, type Settings, type Word,
} from '../shared/model';
import { authenticate, type AuthBindings } from './auth';
import { audit, auditChange, insertRecipient, insertWord, queueOrder } from './data';
import { HttpError, json, readBody, validate } from './http';
import { importRecords } from './imports';
import { previewProvider } from './preview';

type Env = AuthBindings & { DB: D1Database };
const idPattern = z.uuid();
const pageQuery = z.coerce.number().int().min(1).max(100000);
const transitions = {
  approve: { from: ['draft'], to: 'approved' },
  reject: { from: ['draft', 'approved'], to: 'rejected' },
  'restore-draft': { from: ['rejected'], to: 'draft' },
} as const;

async function getWord(db: D1Database, id: string) {
  const word = await db.prepare('SELECT * FROM words WHERE id = ?').bind(id).first<Word>();
  if (!word) throw new HttpError(404, 'Word not found.');
  const {term_normalized, ...record} = word as Word & {term_normalized: string};
  return record;
}

async function getRecipient(db: D1Database, id: string) {
  const recipient = await db.prepare('SELECT * FROM recipients WHERE id = ?').bind(id).first<Recipient & {email_normalized: string}>();
  if (!recipient) throw new HttpError(404, 'Recipient not found.');
  const {email_normalized, ...record} = recipient;
  return record;
}

const wordColumns = 'id,term,real_definition,parody_sentence,part_of_speech,pronunciation,theme,internal_notes,status,queue_priority,approved_at,sent_at,created_at,updated_at';
const recipientColumns = 'id,email,status,display_name,consent_source,consented_at,unsubscribed_at,created_at,updated_at';

async function getPage<T>(db: D1Database, table: 'words' | 'recipients', params: URLSearchParams): Promise<Page<T>> {
  const page = validate(pageQuery, params.get('page') ?? 1);
  const pageSize = validate(z.coerce.number().int().min(1).max(100), params.get('pageSize') ?? 20);
  const query = validate(z.string().trim().max(100), params.get('search') ?? '');
  const words = table === 'words';
  const status = params.has('status') ? validate(words ? wordStatus : recipientStatus, params.get('status')) : null;
  const conditions = [];
  const values = [];
  if (status) {
    conditions.push('status = ?');
    values.push(status);
  }
  if (query) {
    conditions.push(words ? 'instr(term_normalized, ?) > 0' : 'instr(email_normalized, ?) > 0');
    values.push(words ? normalizeTerm(query) : query.toLowerCase());
  }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const sort = words ? (status === 'approved' ? queueOrder : 'created_at DESC, id ASC') : 'email_normalized ASC';
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM ${table}${where}`).bind(...values),
    db.prepare(`SELECT ${words ? wordColumns : recipientColumns} FROM ${table}${where} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .bind(...values, pageSize, (page - 1) * pageSize),
  ]);
  return {total: Number((count.results[0] as {total: number}).total), rows: rows.results as T[], page, pageSize};
}

async function dashboard(db: D1Database): Promise<Dashboard> {
  const [counts, recipients, next] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total,
      COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft,
      COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected,
      COUNT(CASE WHEN status = 'sent' THEN 1 END) AS sent FROM words`),
    db.prepare("SELECT COUNT(*) AS activeRecipients FROM recipients WHERE status = 'active'"),
    db.prepare(`SELECT ${wordColumns} FROM words WHERE status = 'approved' ORDER BY ${queueOrder} LIMIT 1`),
  ]);
  return {
    ...(counts.results[0] as Pick<Dashboard, 'total' | 'draft' | 'approved' | 'rejected' | 'sent'>),
    activeRecipients: Number((recipients.results[0] as {activeRecipients: number}).activeRecipients), next: (next.results[0] as Word | undefined) ?? null,
    target: 365,
  };
}

async function change(db: D1Database, statement: D1PreparedStatement, actor: string, action: string, id: string, now: string) {
  const [result] = await db.batch([statement, auditChange(db, actor, action, id, now)]);
  if (result.meta.changes === 0) throw new HttpError(409, 'This action is unavailable for the current state. Refresh and try again.');
}

async function handle(request: Request, env: Env) {
  const url = new URL(request.url);
  const {pathname, searchParams} = url;
  const {method} = request;
  if (pathname === '/api/health' && method === 'GET') return json({ok: true});
  const identity = await authenticate(request, env);
  if ('status' in identity) throw new HttpError(identity.status, identity.status === 401 ? 'Authentication required.' : 'Administrator access required.');
  const actor = identity.email;
  const db = env.DB;
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'A same-origin request is required.');
  const now = new Date().toISOString();
  const body = () => readBody(request, 24 * 1024);
  const wordMatch = pathname.match(/^\/api\/words\/([^/]+)(?:\/(approve|reject|restore-draft))?$/);
  const recipientMatch = pathname.match(/^\/api\/recipients\/([^/]+)$/);
  const importMatch = pathname.match(/^\/api\/(words|recipients)\/import\/(preview|commit)$/);
  if (method === 'POST' && importMatch) {
    const kind = importMatch[1] as 'words' | 'recipients';
    return json(await importRecords(db, kind, await readBody(request, 256 * 1024), importMatch[2] === 'commit', actor));
  }
  if (method === 'GET' && pathname === '/api/dashboard') return json(await dashboard(db));
  if (pathname === '/api/words') {
    if (method === 'GET') return json(await getPage<Word>(db, 'words', searchParams));
    if (method === 'POST') {
      const value = validate(wordInput, await body());
      const id = crypto.randomUUID();
      await db.batch([insertWord(db, id, value, now), audit(db, actor, 'word.create', id, now)]);
      return json(await getWord(db, id), 201);
    }
  }
  if (wordMatch) {
    const id = validate(idPattern, wordMatch[1]);
    const action = wordMatch[2] as keyof typeof transitions | undefined;
    if (action && method === 'POST') {
      await getWord(db, id);
      const {from, to} = transitions[action];
      await change(db, db.prepare(`UPDATE words SET status=?,approved_at=?,updated_at=? WHERE id=? AND status IN (${from.map(() => '?').join(',')})`)
        .bind(to, to === 'approved' ? now : null, now, id, ...from), actor, `word.${action}`, id, now);
      return json(await getWord(db, id));
    }
    if (!action) {
      if (method === 'GET') return json(await getWord(db, id));
      if (method === 'PATCH') {
        await getWord(db, id);
        const value = validate(wordPatch, await body());
        const statement = 'queue_priority' in value
          ? db.prepare("UPDATE words SET queue_priority=?,updated_at=? WHERE id=? AND status='approved'").bind(value.queue_priority, now, id)
          : db.prepare(`UPDATE words SET term=?,term_normalized=?,real_definition=?,parody_sentence=?,part_of_speech=?,pronunciation=?,theme=?,internal_notes=?,updated_at=?
              WHERE id=? AND status='draft'`).bind(value.term, normalizeTerm(value.term), value.real_definition,
            value.parody_sentence, value.part_of_speech, value.pronunciation, value.theme, value.internal_notes, now, id);
        await change(db, statement, actor, 'word.update', id, now);
        return json(await getWord(db, id));
      }
      if (method === 'DELETE') {
        await getWord(db, id);
        await change(db, db.prepare("DELETE FROM words WHERE id=? AND status='draft'").bind(id), actor, 'word.delete', id, now);
        return new Response(null, {status: 204, headers: {'Cache-Control': 'no-store'}});
      }
    }
  }
  if (pathname === '/api/recipients') {
    if (method === 'GET') return json(await getPage<Recipient>(db, 'recipients', searchParams));
    if (method === 'POST') {
      const value = validate(recipientInput, await body());
      const id = crypto.randomUUID();
      await db.batch([insertRecipient(db, id, value, now), audit(db, actor, 'recipient.create', id, now)]);
      return json(await getRecipient(db, id), 201);
    }
  }
  if (recipientMatch && method === 'PATCH') {
    const id = validate(idPattern, recipientMatch[1]);
    await getRecipient(db, id);
    const {status} = validate(recipientPatch, await body());
    await change(db, db.prepare(`UPDATE recipients
      SET status=?, unsubscribed_at=CASE WHEN ?='unsubscribed' THEN ? ELSE unsubscribed_at END, updated_at=?
      WHERE id=? AND status IN ('active','inactive') AND status<>? AND unsubscribed_at IS NULL
      AND (?<>'active' OR (consent_source IS NOT NULL AND consented_at IS NOT NULL))`)
      .bind(status, status, now, now, id, status, status), actor, `recipient.${status}`, id, now);
    return json(await getRecipient(db, id));
  }
  if (pathname === '/api/email/preview' && method === 'GET') {
    const id = validate(idPattern, searchParams.get('wordId'));
    const subject = validate(z.string().trim().max(160), searchParams.get('subject') ?? '');
    return json(previewProvider.preview(await getWord(db, id), subject || undefined));
  }
  if (pathname === '/api/history' && method === 'GET') {
    const page = validate(pageQuery, searchParams.get('page') ?? 1);
    const [count, rows] = await db.batch([
      db.prepare('SELECT COUNT(*) AS total FROM send_runs'),
      db.prepare(`SELECT r.id,r.schedule_date_et,w.term,r.status,r.created_at,r.completed_at
        FROM send_runs r JOIN words w ON w.id=r.word_id ORDER BY r.schedule_date_et DESC LIMIT 20 OFFSET ?`).bind((page - 1) * 20),
    ]);
    return json({rows: rows.results as SendRun[], total: Number((count.results[0] as {total: number}).total), page, pageSize: 20} satisfies Page<SendRun>);
  }
  if (pathname === '/api/settings') {
    if (method === 'PATCH') {
      const value = validate(settingsInput, await body());
      await db.batch([
        db.prepare('UPDATE app_settings SET timezone=?,send_time=? WHERE id=1').bind(value.timezone, value.send_time),
        audit(db, actor, 'settings.update', null, now),
      ]);
    }
    if (method === 'GET' || method === 'PATCH') return json(await db.prepare('SELECT timezone,send_time,sending_enabled,sender_configured FROM app_settings WHERE id=1').first<Settings>());
  }
  throw new HttpError(404, 'API route not found.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({error: error.message}, error.status);
      const details = error instanceof Error ? [error.message, String(error.cause)].join(' ') : '';
      if (/UNIQUE constraint failed: (words\.term_normalized|recipients\.email_normalized)/.test(details)) {
        return json({error: 'A record with the same normalized term or email already exists.'}, 409);
      }
      // Emit only a generic diagnostic. Database errors can contain personal data.
      console.error('Unexpected admin API failure');
      return json({error: 'The request could not be completed.'}, 500);
    }
  },
};
