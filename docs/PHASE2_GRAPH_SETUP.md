# Future Microsoft Graph setup

Phase 1 uses a render-only email provider. Plan Graph onboarding after explicit approval for the sending phase.

1. Have the Microsoft 365 administrator confirm the existing shared mailbox’s primary address, tenant ID, Entra application client ID, and the enterprise application/service principal object ID. The app registration’s object ID and the enterprise application’s service principal object ID are distinct.
2. Agree on application-only client credentials, credential ownership and rotation, and secure Cloudflare Worker secret bindings. Prefer a certificate or federated credential when the deployment supports it. Keep credentials out of Git, the browser, D1, and chat.
3. Have an Exchange Online administrator register the existing Entra service principal with Exchange Online and grant Exchange Application RBAC **Application Mail.Send** scoped to the one shared mailbox. Use an Exchange recipient scope that matches only the intended mailbox. Confirm any necessary administrative consent with the tenant administrator. Avoid an unscoped Entra Graph application `Mail.Send` grant, since permissions from Entra and Exchange RBAC are additive and a blanket grant would defeat the scope.
4. Verify with `Test-ServicePrincipalAuthorization` that the shared mailbox is in scope and an unrelated mailbox is out of scope. Inspect tenant-wide grants separately. During authorized integration testing, confirm a controlled send from the shared mailbox and verify an out-of-scope request is denied.
5. Add an application-only Graph adapter, targeting `/users/{shared-mailbox-id-or-address}/sendMail`. Treat HTTP 202 as `submitted_to_graph`. Implement a deliberate test flow, throttling, safe logging, and recovery for uncertain outcomes before any live batch.
6. Launch only after a public unsubscribe endpoint is deployed separately from the protected dashboard, consent and suppression checks are verified, and the owner approves delivery. Add scheduling in a separate release after validating Eastern schedule dates, daylight saving, partial-failure recovery, monitoring, and a pause switch.

References: [Exchange Online Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac) and [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).
