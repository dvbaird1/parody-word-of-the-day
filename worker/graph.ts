import type { EmailPreview } from '../shared/model';

export type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
  recipient: string;
};

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

function messageSource(config: GraphConfig, email: EmailPreview) {
  const boundary = 'word-of-the-day-' + crypto.randomUUID();
  const subject = email.subject.match(/.{1,10}/gu)?.map(part => `=?UTF-8?B?${base64(part)}?=`).join('\r\n ') ?? '';
  const part = (type: string, content: string) => [
    '--' + boundary, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '',
    base64(content).match(/.{1,76}/g)?.join('\r\n') ?? '',
  ];
  return [
    `From: <${config.mailbox}>`, `To: <${config.recipient}>`, `Subject: ${subject}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    ...part('text/plain', email.text), ...part('text/html', email.html), '--' + boundary + '--', '',
  ].join('\r\n');
}

export async function graphAccessToken(config: GraphConfig): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default',
      client_id: config.clientId, client_secret: config.clientSecret,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Microsoft token request failed');
  }
  const result = await response.json<{access_token?: string}>();
  if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('Microsoft returned no access token');
  return result.access_token;
}

export async function submitGraphTest(config: GraphConfig, accessToken: string, email: EmailPreview) {
  const body = base64(messageSource(config, email));
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/sendMail`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: {Authorization: 'Bearer ' + accessToken, 'Content-Type': 'text/plain'},
      body,
    });
    if (response.body) void response.body.cancel().catch(() => {});
    if (response.status === 202) return 'submitted_to_graph';
    if (response.status >= 400 && response.status < 500 && response.status !== 408) return 'failed';
  } catch {
    // The request may have reached Graph, so the operator must verify the inbox.
  }
  return 'unknown';
}
