# Scheduled delivery

The dashboard uses the saved timezone and time to start one run per Eastern calendar date. Cloudflare Cron checks once per minute. At spring-forward, a skipped wall-clock time is treated as due after the jump. A 15-minute grace window covers short scheduling gaps. On a fall-back day, the run's unique Eastern date prevents a second send at the repeated time.

## Prepare production

1. Apply [migration 0003](../migrations/0003_scheduled_delivery.sql) once. If production's first migrations were applied manually, apply just this file as a D1 batch. The migration preserves the saved timezone, preferred time, existing email ledger data, and current off setting.
2. Deploy the dashboard Worker with the Cron trigger. Verify that **Settings → Email delivery** shows **Paused**. Use the existing Graph and unsubscribe Worker bindings.
3. Verify the ready queue and active opt-in recipients before launch. After launch approval, use **Enable scheduled sending** in Settings. Use **Pause scheduled sending** to halt new submissions. A Graph submission already in progress can still finish.

## Send and review behavior

- The first eligible tick reserves the next approved word and records the eligible recipients. With an empty queue or no eligible recipients, the tick creates no run.
- Each tick works through up to five pending recipients. The job rechecks consent, opt-out status, the word's approval, and the pause setting before claiming each submission. A same-day paused backlog can resume. Pending deliveries left beyond their Eastern date are recorded as failed.
- Send history shows acceptance by Graph, definitive failures, uncertain outcomes, and suppressions. HTTP 202 confirms Graph accepted the request for processing. Use the inbox to confirm delivery.
- A delivery can be claimed once per recipient per run. If a Graph submission has an uncertain outcome or a Worker stops after claiming it, the job records it as uncertain and excludes it from automatic retries. Any word accepted by Graph or possibly sent is retired from the queue to prevent repeat delivery.
