# Architecture

Vite builds a React SPA and a TypeScript Worker together using the Cloudflare Vite plugin. Workers Static Assets serves the SPA. Worker-first routing reserves `/api` and `/api/*` for the Worker. Each API call except minimal `GET /api/health` requires an administrator. Access should cover the entire deployed admin hostname, even the health route at the edge.

## Authentication and request handling

The Worker verifies the Access assertion against the team’s HTTPS JWKS endpoint using RS256, checks the configured issuer and application audience, requires an unexpired token with subject and email, then checks the normalized email against the administrator allowlist. This check also applies when the static asset router provides no `ctx.access`. Unverified identity headers have no authority. Missing or invalid credentials receive HTTP 401. A verified nonadmin receives HTTP 403.

Mutations require an exact matching Origin, and mutations that read a body require JSON with bounded UTF-8 reads. Runtime schemas reject unexpected fields and D1 statements bind user inputs. API responses are marked no-store. The preview escapes every interpolated HTML value and is displayed in a sandboxed iframe. Local mock auth requires both the explicit `LOCAL_ADMIN_EMAIL` binding and a Vite development-server compile-time flag. The production build compiles that branch out.

## Persistence and queue

Versioned migrations under `migrations/` initialize D1 without example words, recipients, or sends. The dashboard reads counts and the next word in one D1 batch. A normalized NFKC lowercase term key and a trimmed lowercase email key enforce uniqueness at write time. Import preview checks databases and input rows. Commit repeats validation and batches all rows and the audit event atomically, including on a conflicting concurrent write.

Drafts can be edited, deleted, approved, or rejected. Approved words can change priority or be rejected. Rejected words can return to draft for editing and review. Sent words are immutable through the API. Queue order is descending priority (numeric before null), then earliest approval, creation time, and ID. Active recipients require consent source and date. Inactive recipients with existing consent can be activated. Unsubscribed and suppressed states have no reactivation route in Phase 1.

`send_runs` reserves one run per America/New_York schedule date. `send_deliveries` reserves one row per run/recipient. No Phase 1 API writes to either table. A future claiming transaction must choose an approved, unsent word, prevent multiple runs claiming the same word, and define how partial and uncertain submissions are recovered. Graph submission acceptance is separate from inbox delivery. Settings and database constraints keep delivery and sender readiness disabled for Phase 1. Sensitive admin mutations write audit records with actor, action, record ID, and timestamp.

## Integration boundaries

`worker/preview.ts` defines the current `EmailProvider` interface and its render-only implementation. A future Graph adapter should use a separate, explicit submission operation and store credentials in Worker secret bindings. There is no cron trigger. A later scheduler should evaluate the stored local time with daylight-saving rules and derive the Eastern schedule key idempotently. Start with human-authored words or CSV/JSON drafts. A later AI adapter must save generation output as drafts pending human review.
