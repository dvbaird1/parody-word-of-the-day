import { normalizeEmail, normalizeTerm, type RecipientInput, type WordInput } from '../shared/model';

export const queueOrder = 'queue_priority DESC, approved_at ASC, created_at ASC, id ASC';
export const insertWord = (db: D1Database, id: string, value: WordInput, now: string) => db.prepare(
  `INSERT INTO words (id,term,term_normalized,real_definition,parody_sentence,part_of_speech,pronunciation,theme,internal_notes,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
).bind(id, value.term, normalizeTerm(value.term), value.real_definition, value.parody_sentence, value.part_of_speech,
  value.pronunciation, value.theme, value.internal_notes, now, now);

export const insertRecipient = (db: D1Database, id: string, value: RecipientInput, now: string) => db.prepare(
  `INSERT INTO recipients (id,email,email_normalized,status,display_name,consent_source,consented_at,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
).bind(id, value.email, normalizeEmail(value.email), value.status, value.display_name, value.consent_source, value.consented_at, now, now);

export const audit = (db: D1Database, actor: string, action: string, id: string | null, now: string) =>
  db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, action, id, now);

// Must immediately follow a conditional write in the same atomic D1 batch.
export const auditChange = (db: D1Database, actor: string, action: string, id: string | null, now: string) =>
  db.prepare('INSERT INTO audit_events SELECT ?,?,?,?,? WHERE changes() > 0').bind(crypto.randomUUID(), actor, action, id, now);
