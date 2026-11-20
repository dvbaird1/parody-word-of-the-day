CREATE TABLE email_test_sends (
  recipient_email TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE,
  word_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted_to_graph', 'failed', 'unknown')),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
