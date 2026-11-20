# Manual Microsoft Graph test

The admin-only action in **Email preview → Send a test email** submits one test to the configured inbox. It requires an approved word and a confirmation click. The messages use the shared mailbox as the sender and have HTML and plain-text parts with the recipient's signed unsubscribe link. The test is recorded in `email_test_sends`, leaving the daily word inventory and send history available for regular delivery.

## Prepare production

1. In Entra, confirm the Enterprise application has no tenant-wide Microsoft Graph application `Mail.Send` grant. Verify the Exchange RBAC `Application Mail.Send` assignment is scoped to `wordoftheday@db3it.com`.
2. On the existing production D1 database, apply [0002_email_test_sends.sql](../migrations/0002_email_test_sends.sql) once. If the initial schema was applied manually in the dashboard, run just this new SQL file in the D1 Console. For a database tracked by Wrangler migrations, use `npx wrangler d1 migrations apply DB --remote`.
3. Deploy the unsubscribe Worker first with `npx wrangler deploy --config wrangler.unsubscribe.jsonc`. Verify that its public custom hostname is `unsubscribe.dvb3.org` and that `UNSUBSCRIBE_SIGNING_KEY` remains an encrypted secret. The new `UnsubscribeLinks` service entrypoint signs links for the dashboard using the existing key.
4. Build and deploy the Cloudflare Access-protected admin Worker with `npm run build` and `npm run deploy`, or release the same code through Workers Builds after deploying the signer. The admin configuration already supplies the tenant ID, client ID, shared mailbox, and single test inbox `dbaird@dvb3.org`.
5. In Entra **App registrations → Word of the Day → Certificates & secrets**, create a client secret. In Cloudflare **Workers & Pages → parody-word-of-the-day → Settings → Variables and Secrets**, add the **Value** as an encrypted secret named `GRAPH_CLIENT_SECRET`. Keep it out of Git and chat.

## Run the approved test

In the dashboard, select an approved word in **Email preview**, then click **Send one test** and confirm the fixed destination. Check the subject and sender in the inbox, both email formats, the HTML in light and dark mode, and the unsubscribe flow. If the test inbox had no recipient record, the dashboard creates an inactive one so its unsubscribe link can be verified. An existing opt-out or suppression blocks the send.

`submitted_to_graph` means Graph returned HTTP 202. Use the inbox to verify delivery. A deliberate retry is available after a definite rejection or a failure before submission. A pending or uncertain result blocks retries to avoid sending a duplicate. Check the inbox and establish what happened before resetting a pending test record. The test does not mark its word as sent.

References: [Exchange Online Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac) and [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).
