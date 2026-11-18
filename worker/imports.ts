import { parse } from 'csv-parse/browser/esm/sync';
import { z } from 'zod';
import { normalizeEmail, normalizeTerm, recipientInput, wordInput, type ImportReport, type RecipientInput, type WordInput } from '../shared/model';
import { audit, insertRecipient, insertWord } from './data';
import { HttpError, validate } from './http';

const upload = z.strictObject({format: z.enum(['csv', 'json']), content: z.string().min(1).max(128 * 1024)});
const wordHeaders = Object.keys(wordInput.shape);
const recipientHeaders = ['email', 'display_name', 'consent_source', 'consented_at', 'status'];

function records(value: z.infer<typeof upload>, headers: string[]): unknown[] {
  if (value.format === 'json') {
    let raw: unknown;
    try { raw = JSON.parse(value.content); } catch { throw new HttpError(400, 'Invalid JSON import.'); }
    if (!Array.isArray(raw)) throw new HttpError(400, 'Provide a JSON array of records.');
    return raw;
  }
  let parsed: string[][];
  try {
    parsed = parse(value.content, {bom: true, trim: true, skip_empty_lines: true, relax_column_count: true});
  } catch {
    throw new HttpError(400, 'Invalid CSV. Check quoting and field separators.');
  }
  const [heading, ...data] = parsed;
  const fields = heading?.map(field => field.trim()) ?? [];
  if (!fields.length || new Set(fields).size !== fields.length || fields.some(field => !headers.includes(field))) {
    throw new HttpError(400, 'CSV headers must be unique and use the documented column names.');
  }
  return data.map(row => row.length === fields.length
    ? Object.fromEntries(fields.map((field, index) => [field, row[index].trim() || undefined]))
    : null);
}

export async function importRecords(db: D1Database, kind: 'words' | 'recipients', body: unknown, commit: boolean, actor: string) {
  const words = kind === 'words';
  const value = validate(upload, body);
  if (new TextEncoder().encode(value.content).byteLength > 128 * 1024) throw new HttpError(413, 'Import content exceeds 128 KiB.');
  const source = records(value, words ? wordHeaders : recipientHeaders);
  if (!source.length || source.length > 100) throw new HttpError(400, 'Import 1 to 100 records at a time.');
  const schema = words ? wordInput : recipientInput;
  const column = words ? 'term_normalized' : 'email_normalized';
  const candidates = source.map(row => schema.safeParse(row));
  const keyFor = (row: WordInput | RecipientInput) => 'term' in row ? normalizeTerm(row.term) : normalizeEmail(row.email);
  const keys = [...new Set(candidates.flatMap(candidate => candidate.success ? [keyFor(candidate.data)] : []))];
  const existing = keys.length
    ? await db.prepare(`SELECT ${column} AS key FROM ${kind} WHERE ${column} IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{key: string}>()
    : {results: []};
  const inDatabase = new Set(existing.results.map(row => row.key));
  const seen = new Set<string>();
  const report: ImportReport = {total: source.length, valid: 0, invalid: 0, duplicates: 0, rows: []};
  const pending: (WordInput | RecipientInput)[] = [];
  candidates.forEach((candidate, index) => {
    const row = index + 1;
    if (!candidate.success) {
      report.invalid++;
      report.rows.push({row, label: '', status: 'invalid', message: candidate.error.issues.map(issue => `${issue.path.join('.') || 'Record'}: ${issue.message}`).join('; ')});
      return;
    }
    const key = keyFor(candidate.data);
    const label = 'term' in candidate.data ? candidate.data.term : candidate.data.email;
    if (inDatabase.has(key) || seen.has(key)) {
      report.duplicates++;
      report.rows.push({row, label, status: 'duplicate', message: inDatabase.has(key) ? 'Already in the database.' : 'Repeated in this import.'});
      return;
    }
    seen.add(key);
    pending.push(candidate.data);
    report.valid++;
    report.rows.push({row, label, status: 'valid'});
  });
  if (!commit) return report;
  if (report.invalid || report.duplicates) throw new HttpError(409, 'Nothing imported. Resolve invalid or duplicate rows and preview again.');
  const now = new Date().toISOString();
  await db.batch([
    ...pending.map(value => 'term' in value ? insertWord(db, crypto.randomUUID(), value, now) : insertRecipient(db, crypto.randomUUID(), value, now)),
    audit(db, actor, `${kind}.import`, null, now),
  ]);
  return report;
}
