ALTER TABLE app_settings RENAME TO app_settings_previous;
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  send_time TEXT NOT NULL DEFAULT '08:00' CHECK(send_time GLOB '[0-2][0-9]:[0-5][0-9]' AND send_time < '24:00'),
  sending_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sending_enabled IN (0, 1)),
  sender_configured INTEGER NOT NULL DEFAULT 0 CHECK(sender_configured = 0)
);
INSERT INTO app_settings SELECT * FROM app_settings_previous;
DROP TABLE app_settings_previous;

ALTER TABLE send_deliveries RENAME TO send_deliveries_previous;
CREATE TABLE send_deliveries (
  run_id TEXT NOT NULL REFERENCES send_runs(id),
  recipient_id TEXT NOT NULL REFERENCES recipients(id),
  status TEXT NOT NULL CHECK(status IN ('pending','submitting','submitted_to_graph','failed','unknown','suppressed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(run_id, recipient_id)
);
INSERT INTO send_deliveries SELECT * FROM send_deliveries_previous;
DROP TABLE send_deliveries_previous;
CREATE INDEX deliveries_recipient ON send_deliveries(recipient_id);
CREATE INDEX deliveries_run_status ON send_deliveries(run_id, status, recipient_id);
