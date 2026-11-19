import { auditChange } from '../data';
import { verifyUnsubscribeToken } from './token';

type Env = {DB: D1Database; UNSUBSCRIBE_SIGNING_KEY?: string};

function page(title: string, message: string, status = 200, form = '', extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  // Keep the token out of the referrer without making the browser's form Origin opaque.
  headers.set('Referrer-Policy', 'strict-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Word of the Day</title>
<style>
  body{margin:0;padding:2rem 1rem;background:#f8f7f1;color:#23251e;font:1rem/1.55 system-ui,sans-serif}
  main{max-width:28rem;margin:clamp(1rem,8vh,5rem) auto;padding:clamp(1.25rem,5vw,2.5rem);border:1px solid #ded8c9;border-radius:1rem;background:#fffdf7}
  h1{font:clamp(2rem,7vw,3rem)/1.1 Georgia,serif;margin:.75rem 0}
  strong{color:#354b32}
  button{margin-top:.75rem;padding:.7rem 1rem;background:#354b32;color:#fff;border:0;border-radius:.4rem;font:inherit;font-weight:600;cursor:pointer}
  button:focus-visible{outline:3px solid #23251e;outline-offset:3px}
</style></head><body><main><strong>Word of the Day</strong><h1>${title}</h1><p>${message}</p>${form}</main></body></html>`, {
    status, headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/unsubscribed' && request.method === 'GET') {
      return page('Unsubscribed', 'This email subscription is no longer active.');
    }
    if (url.pathname !== '/unsubscribe') return page('Page unavailable', 'Open the unsubscribe link in your email.', 404);
    if (request.method !== 'GET' && request.method !== 'POST') {
      return page('Method unavailable', 'Open the unsubscribe link in your email.', 405, '', {Allow: 'GET, POST'});
    }
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) {
      return page('Request could not be verified', 'Open the unsubscribe link in your email and try again.', 403);
    }

    try {
      const tokens = url.searchParams.getAll('token');
      const token = tokens[0];
      const id = tokens.length === 1 && token ? await verifyUnsubscribeToken(token, env.UNSUBSCRIBE_SIGNING_KEY) : null;
      if (!id) return page('Invalid unsubscribe link', 'This link is invalid or has expired. Use a recent Word of the Day email to unsubscribe.', 400);
      if (request.method === 'GET') {
        // Token verification restricts this value to URL-safe characters before interpolation.
        return page('Unsubscribe', 'Confirm to stop receiving Word of the Day emails.', 200,
          `<form method="post" action="/unsubscribe?token=${token}"><button type="submit">Unsubscribe</button></form>`);
      }

      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`UPDATE recipients
          SET status = CASE WHEN status = 'suppressed' THEN status ELSE 'unsubscribed' END,
              unsubscribed_at = ?, updated_at = ?
          WHERE id = ? AND unsubscribed_at IS NULL`).bind(now, now, id),
        auditChange(env.DB, 'recipient', 'recipient.public-unsubscribe', id, now),
      ]);
      return new Response(null, {status: 303, headers: {
        Location: '/unsubscribed', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      }});
    } catch {
      return page('Unsubscribe unavailable', 'Please try again in a few minutes.', 503);
    }
  },
};
