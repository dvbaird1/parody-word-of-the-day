# Parody Word of the Day

A private admin dashboard for a vocabulary email that pairs a real definition with a deliberately wrong example sentence. Phase 1 covers manual authoring, approval, queue planning, recipient consent, and preview. Scheduled email delivery starts paused. Paid AI is off. A separately configured manual send can test Microsoft Graph with a single approved inbox.

## Run locally

Use Node.js 22.12 or later and npm. From the repository root:

```sh
npm ci
cp .dev.vars.example .dev.vars   # For a new checkout
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:5173. The example opts into local mock admin authentication for the Vite development server. Keep the server bound to loopback. Remove `LOCAL_ADMIN_EMAIL` from `.dev.vars` to exercise anonymous API rejection. The development database persists under `.wrangler/state` and starts empty.

```sh
npm run typecheck
npm test
npm run build
```

The tests use isolated Miniflare D1 and local signing keys. No credentials, hosted databases, or email services are needed. TypeScript checks the frontend and Worker. The production build emits both bundles under `dist/`.

## Admin workflow

1. Create a draft with a real, recognizable word, an accurate definition, and a deadpan misuse. Verify the real definition before approving. Approving a word places it in the ready queue. In the library’s **approved** filter, a higher numeric priority moves a word forward. Empty priorities follow numeric priorities.
2. Import words or recipients with CSV headers or a JSON array of objects. Preview first and resolve every invalid or duplicate row before committing. The maximum is 100 rows and 128 KiB of UTF-8 content per import. Imported words start as drafts. CSV supports quoted commas and newlines.
3. Activate recipients only when you can record an opt-in source and date. Deactivation preserves consent, and recorded unsubscribes cannot be reversed in Phase 1.
4. Select a real library entry in **Email preview** and render the HTML or plain-text version. The settings store a preferred timezone and time, initially 08:00 America/New_York. The preview, settings, and history are available throughout Phase 1.

### Import column names

- Words require `term`, `real_definition`, and `parody_sentence`. Optional fields are `part_of_speech`, `pronunciation`, `theme`, and `internal_notes`.
- Recipients require `email`. Optional fields are `display_name`, `consent_source`, `consented_at` (YYYY-MM-DD), and `status` (`active` by default, or `inactive`). An active recipient requires both consent fields. Existing addresses, including inactive or unsubscribed ones, are reported as duplicates.

## Eventual Cloudflare deployment

Perform these steps only after deployment approval.

1. Create a production D1 database with `npx wrangler d1 create parody-word-of-the-day`. Replace the all-zero local placeholder in `wrangler.jsonc` with the returned ID. Apply `npx wrangler d1 migrations apply DB --remote` against that database. Use separate databases for production and any staging setup.
2. Configure Cloudflare Access for the entire admin hostname, including static assets and API paths. Use an explicit admin policy. Keep Workers.dev and preview URLs disabled, and protect every other hostname that can reach the app before exposing it.
3. Configure Worker-side `ACCESS_ISSUER` (e.g. `https://YOUR-TEAM.cloudflareaccess.com`, no trailing slash), `ACCESS_AUDIENCE` (the Access application AUD), and `ADMIN_EMAILS` (comma-separated exact emails). Configure these in Worker settings or with `wrangler secret put`; the SPA needs none of them.
4. Run `npm run build` and `npm run deploy` and attach the Access-protected custom domain. Verify anonymous navigation reaches Access, direct API requests with spoofed identity fail, signed nonadmin requests fail, and allowlisted admins can make same-origin reads and writes. Verify equivalent protection on any future staging or preview host. This live verification requires the actual Access configuration.

See [architecture](docs/ARCHITECTURE.md), the [public unsubscribe deployment guide](docs/UNSUBSCRIBE.md), the [Exchange mailbox scope setup](docs/PHASE2_GRAPH_SETUP.md), the [manual Graph test guide](docs/GRAPH_TEST_SEND.md), and the [scheduled delivery guide](docs/SCHEDULED_DELIVERY.md).
