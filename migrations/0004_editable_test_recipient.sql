ALTER TABLE email_test_sends RENAME TO email_test_sends_previous;
CREATE TABLE email_test_sends (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  recipient_email TEXT NOT NULL,
  word_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted_to_graph', 'failed', 'unknown')),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO email_test_sends (attempt_id,recipient_email,word_id,actor,status,started_at,updated_at)
SELECT attempt_id,recipient_email,word_id,actor,status,started_at,updated_at FROM email_test_sends_previous;
DROP TABLE email_test_sends_previous;
CREATE UNIQUE INDEX email_test_unresolved ON email_test_sends(recipient_email)
WHERE status IN ('pending', 'unknown');
