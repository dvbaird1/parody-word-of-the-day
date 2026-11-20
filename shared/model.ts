import { z } from 'zod';

export const wordStatus = z.enum(['draft', 'approved', 'rejected', 'sent']);
export const recipientStatus = z.enum(['active', 'inactive', 'unsubscribed', 'suppressed']);
export const normalizeTerm = (value: string) => value.trim().normalize('NFKC').toLowerCase();
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
const required = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).nullish().transform(value => value || null);
const date = z.iso.date().nullable().optional().transform(value => value ?? null);
export const wordInput = z.strictObject({
  term: required(100), real_definition: required(2000), parody_sentence: required(1000),
  part_of_speech: optional(80), pronunciation: optional(160), theme: optional(100),
  internal_notes: optional(2000),
});
const recipientFields = {
  email: z.string().trim().max(254).pipe(z.email()),
  display_name: optional(160), consent_source: optional(200), consented_at: date,
  status: z.enum(['active', 'inactive']).default('active'),
};
function checkConsent(value: { status: string; consent_source: string | null; consented_at: string | null }, ctx: z.RefinementCtx) {
  if (value.status === 'active' && (!value.consented_at || !value.consent_source)) {
    ctx.addIssue({code: 'custom', path: ['consent_source'], message: 'Active recipients require a consent source and date.'});
  }
  if (value.consented_at && value.consented_at > new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({code: 'custom', path: ['consented_at'], message: 'Consent date cannot be in the future.'});
  }
}
export const recipientInput = z.strictObject(recipientFields).superRefine(checkConsent);
export const wordPatch = z.union([
  wordInput,
  z.strictObject({ queue_priority: z.number().int().min(-10000).max(10000).nullable() }),
]);
export const recipientPatch = z.strictObject({status: z.enum(['active', 'inactive', 'unsubscribed', 'suppressed'])});
export const settingsInput = z.strictObject({
  send_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: required(100).refine(value => {
    try { new Intl.DateTimeFormat('en', {timeZone: value}); return /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value); }
    catch { return false; }
  }, 'Use a valid IANA timezone'),
});
export type WordInput = z.output<typeof wordInput>;
export type RecipientInput = z.output<typeof recipientInput>;
export type Word = WordInput & {
  id: string; status: z.infer<typeof wordStatus>; queue_priority: number | null;
  approved_at: string | null; sent_at: string | null; created_at: string; updated_at: string;
};
export type Recipient = Omit<RecipientInput, 'status'> & {
  id: string; status: z.infer<typeof recipientStatus>; unsubscribed_at: string | null;
  created_at: string; updated_at: string;
};
export type Dashboard = {
  total: number; draft: number; approved: number; rejected: number; sent: number;
  activeRecipients: number; next: Word | null; target: 365;
};
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };
export type ImportReport = {
  total: number; valid: number; invalid: number; duplicates: number;
  rows: { row: number; label: string; status: 'valid' | 'invalid' | 'duplicate'; message?: string }[];
};
export type Settings = z.output<typeof settingsInput> & {sending_enabled: 0; sender_configured: 0};
export type SendRun = {id: string; schedule_date_et: string; term: string; status: string; created_at: string; completed_at: string | null};
export type EmailPreview = {subject: string; html: string; text: string};

export type EmailTest = {
  recipient: string | null;
  configured: boolean;
  status: 'pending' | 'submitted_to_graph' | 'failed' | 'unknown' | null;
};
