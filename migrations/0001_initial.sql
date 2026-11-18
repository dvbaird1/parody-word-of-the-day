CREATE TABLE words (
  id TEXT PRIMARY KEY NOT NULL,
  term TEXT NOT NULL CHECK(length(trim(term)) > 0),
  term_normalized TEXT NOT NULL UNIQUE CHECK(length(term_normalized) > 0),
  part_of_speech TEXT,
  real_definition TEXT NOT NULL CHECK(length(trim(real_definition)) > 0),
  parody_sentence TEXT NOT NULL CHECK(length(trim(parody_sentence)) > 0),
  pronunciation TEXT,
  theme TEXT,
  internal_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected','sent')),
  queue_priority INTEGER CHECK(queue_priority BETWEEN -10000 AND 10000),
  approved_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(status <> 'approved' OR approved_at IS NOT NULL),
  CHECK((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX words_queue ON words(status, queue_priority DESC, approved_at, created_at, id);
CREATE TABLE recipients (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE CHECK(email_normalized = lower(trim(email))),
  status TEXT NOT NULL CHECK(status IN ('active','inactive','unsubscribed','suppressed')),
  display_name TEXT,
  consent_source TEXT,
  consented_at TEXT,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(status <> 'active' OR (consent_source IS NOT NULL AND consented_at IS NOT NULL AND unsubscribed_at IS NULL)),
  CHECK(status <> 'unsubscribed' OR unsubscribed_at IS NOT NULL)
);
CREATE INDEX recipients_status ON recipients(status, email_normalized);
CREATE TABLE send_runs (
  id TEXT PRIMARY KEY NOT NULL,
  schedule_date_et TEXT NOT NULL UNIQUE CHECK(schedule_date_et IS date(schedule_date_et)),
  word_id TEXT NOT NULL REFERENCES words(id),
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  safe_error_summary TEXT
);
CREATE INDEX runs_word ON send_runs(word_id);
CREATE TABLE send_deliveries (
  run_id TEXT NOT NULL REFERENCES send_runs(id),
  recipient_id TEXT NOT NULL REFERENCES recipients(id),
  status TEXT NOT NULL CHECK(status IN ('pending','submitted_to_graph','failed','suppressed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(run_id, recipient_id)
);
CREATE INDEX deliveries_recipient ON send_deliveries(recipient_id);
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  send_time TEXT NOT NULL DEFAULT '08:00' CHECK(send_time GLOB '[0-2][0-9]:[0-5][0-9]' AND send_time < '24:00'),
  sending_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sending_enabled = 0),
  sender_configured INTEGER NOT NULL DEFAULT 0 CHECK(sender_configured = 0)
);
INSERT INTO app_settings(id) VALUES (1);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_id TEXT,
  created_at TEXT NOT NULL
);
