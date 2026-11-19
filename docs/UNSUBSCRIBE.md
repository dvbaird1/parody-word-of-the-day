# Deploy the public unsubscribe Worker

The public Worker serves a confirmation page at `/unsubscribe` and a completion page at `/unsubscribed`. It uses the existing production D1 database. The admin app stays behind Cloudflare Access on its own hostname. Opening a link only shows the confirmation page so a mail scanner's GET cannot unsubscribe anyone. Confirming records the opt-out and an audit event in a single D1 batch.

## Cloudflare setup

1. Choose an unused custom hostname in your Cloudflare account for unsubscribe, such as `unsubscribe.example.com`. Keep the existing Access application scoped to the admin hostname, and make sure no wildcard Access app intercepts the public hostname.
2. Deploy the separate Worker using an authenticated Cloudflare identity with Workers deployment permission:

   ```sh
   npx wrangler deploy --config wrangler.unsubscribe.jsonc
   ```

   The configuration binds the same `DB` as the dashboard. It disables both the `workers.dev` and preview URLs. This feature uses the existing schema and needs no new migration.
3. Generate a dedicated 32-byte random key encoded as 64 hex characters. For example, use `openssl rand -hex 32` in a private terminal. Save it in **Workers & Pages → parody-word-unsubscribe → Settings → Variables and Secrets** as an encrypted secret named `UNSUBSCRIBE_SIGNING_KEY`. Keep it available in an approved secret store so the later sender can sign links with the same key. Rotating the key invalidates links signed with the old key.
4. Attach the public hostname in the unsubscribe Worker’s **Settings → Domains & Routes → Add → Custom Domain**.

## Production check

Create an active test recipient you control using the private dashboard and record its recipient UUID. Obtain a signed HTTPS link with `createUnsubscribeUrl` in `worker/unsubscribe/token.ts`. If running the helper manually, provide `UNSUBSCRIBE_SIGNING_KEY` through your local secret store and set `UNSUBSCRIBE_ORIGIN` to the public HTTPS origin without a trailing slash and `TEST_RECIPIENT_ID` to the test UUID:

```sh
node --experimental-strip-types --input-type=module -e '
  import {createUnsubscribeUrl} from "./worker/unsubscribe/token.ts";
  const {UNSUBSCRIBE_ORIGIN, TEST_RECIPIENT_ID, UNSUBSCRIBE_SIGNING_KEY} = process.env;
  console.log((await createUnsubscribeUrl(UNSUBSCRIBE_ORIGIN, TEST_RECIPIENT_ID, UNSUBSCRIBE_SIGNING_KEY)).href);
'
```

Handle the link privately. It authorizes unsubscribing that test recipient.

1. Open the link in a private browser window. Verify the confirmation page opens without Access sign-in and the dashboard still shows the recipient as active.
2. Click **Unsubscribe**. Verify the completion page, the recipient’s unsubscribed status and timestamp in D1, and the drop in the dashboard's active count. Reopen and confirm the same link to check that the original timestamp stays the same.
3. Verify the private dashboard still prompts for Access sign-in and the public hostname returns 404 for `/api/recipients`.

## Use in the future sender

For each delivered email, generate a signed link for that recipient and add the link to both versions of the message. The token covers only unsubscribe for a single recipient UUID and expires after one year. It contains no email address. Keep the link out of application logs. The preview footer tells administrators where a personal link will appear.

Query only recipients where `status = 'active'` and `unsubscribed_at IS NULL` for delivery, and check eligibility again immediately before submission. Confirmed opt-outs change active and inactive recipients to `unsubscribed`. Suppressed recipients stay suppressed and also get an opt-out timestamp. No Graph integration or scheduling is needed to test the unsubscribe flow.
