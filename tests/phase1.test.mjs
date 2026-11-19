import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const origin = 'http://localhost';
const issuer = 'https://example-team.cloudflareaccess.com';
const audience = 'test-application';
const admin = 'admin@local.test';
const bindings = {LOCAL_ADMIN_EMAIL: admin, ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: audience, ADMIN_EMAILS: admin};
const word = (term, real_definition = 'Showing great attention to detail.') => ({
  term, real_definition, parody_sentence: 'Please leave the meticulous on the porch.',
});
const recipient = email => ({email, consent_source: 'Test opt-in form', consented_at: '2025-01-01'});
const csv = (kind, contents) => ({format: 'csv', content: `${kind}\n${contents}`});
const json = values => ({format: 'json', content: JSON.stringify(values)});
const unsubscribeOrigin = 'https://unsubscribe.example.test';
const unsubscribeKey = randomBytes(32).toString('hex');
let temp, local, production, productionWorker, db, createUnsubscribeUrl;

async function request(runtime, path, method = 'GET', body, headers = {}) {
  const response = await runtime.dispatchFetch(origin + '/api' + path, {
    method, headers: {Origin: origin, ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...headers},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return {status: response.status, data: response.status === 204 ? null : await response.json()};
}
async function expect(path, status, method = 'GET', body, headers) {
  const result = await request(local, path, method, body, headers);
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}

before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'parody-phase1-'));
  async function bundle(name, mock, entry = 'worker/index.ts') {
    const scriptPath = join(temp, name + '.mjs');
    await build({
      entryPoints: [entry], outfile: scriptPath, bundle: true,
      platform: 'node', format: 'esm', target: 'es2022',
      define: {__LOCAL_DEV_BUILD__: String(mock)},
    });
    return scriptPath;
  }
  const common = {rootPath: temp, modulesRoot: temp, modules: true, compatibilityDate: '2026-04-01', bindings};
  const productionPath = await bundle('production', false);
  local = new Miniflare(convertV4MiniflareOptions({cf: false, workers: [
    {...common, name: 'admin', scriptPath: await bundle('local', true), d1Databases: {DB: 'phase1-test'}},
    {...common, name: 'unsubscribe', routes: ['unsubscribe.example.test/*'], bindings: {UNSUBSCRIBE_SIGNING_KEY: unsubscribeKey},
      scriptPath: await bundle('unsubscribe', false, 'worker/unsubscribe/index.ts'), d1Databases: {DB: 'phase1-test'}},
  ]}));
  const tokenPath = await bundle('unsubscribe-token', false, 'worker/unsubscribe/token.ts');
  ({createUnsubscribeUrl} = await import(pathToFileURL(tokenPath).href));
  production = new Miniflare(convertV4MiniflareOptions({cf: false, ...common, scriptPath: productionPath}));
  productionWorker = (await import(pathToFileURL(productionPath).href)).default;
  db = await local.getD1Database('DB');
  const migration = await readFile('migrations/0001_initial.sql', 'utf8');
  await db.batch(migration.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => db.prepare(statement)));
});

after(async () => {
  await Promise.all([local?.dispose(), production?.dispose()]);
  if (temp) await rm(temp, {recursive: true, force: true});
});

test('empty migration has accurate inventory and history, and scheduling is off', async () => {
  assert.deepEqual(await expect('/dashboard', 200), {
    total: 0, draft: 0, approved: 0, rejected: 0, sent: 0, activeRecipients: 0, next: null, target: 365,
  });
  assert.equal((await expect('/history', 200)).total, 0);
  assert.deepEqual(await expect('/settings', 200), {timezone: 'America/New_York', send_time: '08:00', sending_enabled: 0, sender_configured: 0});
  await expect('/settings', 400, 'PATCH', {timezone: 'America/New_York', send_time: '08:00', sending_enabled: 1});
  const updated = await expect('/settings', 200, 'PATCH', {timezone: 'America/Chicago', send_time: '09:30'});
  assert.equal(updated.send_time, '09:30');
  assert.equal(updated.sending_enabled, 0);
});

test('word validation, normalization, editing, transitions, pagination, ordering and counts', async () => {
  await expect('/words', 400, 'POST', word('Meticulous', '   '));
  const draft = await expect('/words', 201, 'POST', word('  Meticulous  '));
  const path = '/words/' + draft.id;
  assert.equal(draft.term, 'Meticulous');
  assert.equal(draft.status, 'draft');
  assert.equal((await expect('/dashboard', 200)).draft, 1);
  await expect('/words', 409, 'POST', word('ｍＥＴＩＣＵＬＯＵＳ'));
  const modified = await expect(path, 200, 'PATCH', word('Meticulous', 'Very careful and precise.'));
  assert.equal(modified.real_definition, 'Very careful and precise.');
  await expect(path + '/restore-draft', 409, 'POST');
  await expect(path + '/reject', 200, 'POST');
  assert.equal((await expect('/dashboard', 200)).rejected, 1);
  await expect(path, 409, 'DELETE');
  await expect(path + '/approve', 409, 'POST');
  await expect(path + '/restore-draft', 200, 'POST');
  const approved = await expect(path + '/approve', 200, 'POST');
  assert.ok(approved.approved_at);
  await expect(path + '/approve', 409, 'POST');
  await expect(path, 409, 'PATCH', word('Conspicuous'));
  const another = await expect('/words', 201, 'POST', word('Conspicuous'));
  const anotherPath = '/words/' + another.id;
  await expect(anotherPath, 409, 'PATCH', word(' METICULOUS '));
  await expect(anotherPath + '/approve', 200, 'POST');
  await expect(anotherPath, 200, 'PATCH', {queue_priority: 10});
  const overview = await expect('/dashboard', 200);
  assert.deepEqual([overview.total, overview.draft, overview.approved, overview.rejected, overview.sent], [2, 0, 2, 0, 0]);
  assert.equal(overview.next.id, another.id);
  const ready = await expect('/words?status=approved&pageSize=1&page=2', 200);
  assert.equal(ready.total, 2);
  assert.equal(ready.rows[0].id, draft.id);
  assert.equal((await expect('/words?search=METIC', 200)).total, 1);

  const disposable = await expect('/words', 201, 'POST', word('Disposable'));
  await expect('/words/' + disposable.id, 204, 'DELETE');
  await expect('/words/' + disposable.id, 404);
  const sent = await expect('/words', 201, 'POST', word('Sanguine'));
  await db.prepare("UPDATE words SET status='sent',sent_at='2025-01-01' WHERE id=?").bind(sent.id).run();
  const sentPath = '/words/' + sent.id;
  await expect(sentPath, 409, 'DELETE');
  await expect(sentPath, 409, 'PATCH', word('Removed'));
  await expect(sentPath, 409, 'PATCH', {queue_priority: 100});
  await expect(sentPath + '/reject', 409, 'POST');
  assert.equal((await expect('/dashboard', 200)).sent, 1);
});

test('JSON and CSV imports classify invalid and duplicate rows before atomic commit', async () => {
  const mixed = json([word('Meticulous'), word(' Luminous '), word('LUMINOUS'), {term: 'Invalid', status: 'approved'}]);
  const preview = await expect('/words/import/preview', 200, 'POST', mixed);
  assert.deepEqual([preview.total, preview.valid, preview.invalid, preview.duplicates], [4, 1, 1, 2]);
  assert.deepEqual(preview.rows.map(row => row.status), ['duplicate', 'valid', 'duplicate', 'invalid']);
  await expect('/words/import/commit', 409, 'POST', mixed);
  assert.equal((await expect('/words?search=luminous', 200)).total, 0);
  const input = csv('term,real_definition,parody_sentence', 'Luminous,"Giving off light, or bright.","Did you put the luminous in the fridge?"');
  assert.equal((await expect('/words/import/preview', 200, 'POST', input)).valid, 1);
  assert.equal((await expect('/words?search=luminous', 200)).total, 0);
  assert.equal((await expect('/words/import/commit', 200, 'POST', input)).valid, 1);
  assert.equal((await expect('/words?search=luminous', 200)).rows[0].status, 'draft');
  await expect('/words/import/commit', 409, 'POST', input);
  await expect('/words/import/preview', 400, 'POST', csv('term,term', 'one,two'));
  await expect('/words/import/preview', 400, 'POST', json(Array.from({length: 101}, (_, i) => word('Term' + i))));
  await expect('/words/import/preview', 413, 'POST', {format: 'csv', content: 'x'.repeat(270000)});
  const contested = word('Elusive');
  const writes = await Promise.all([
    request(local, '/words/import/commit', 'POST', json([word('Indelible'), contested])),
    request(local, '/words', 'POST', contested),
  ]);
  assert.deepEqual(writes.map(write => write.status).sort(), writes[0].status === 200 ? [200, 409] : [201, 409]);
  assert.equal((await expect('/words?search=indelible', 200)).total, writes[0].status === 200 ? 1 : 0);
});

test('recipient consent, normalized duplicate rejection, deactivation and sticky unsubscribe', async () => {
  await expect('/recipients', 400, 'POST', recipient('invalid'));
  await expect('/recipients', 400, 'POST', {email: 'no-consent@example.com'});
  const person = await expect('/recipients', 201, 'POST', recipient('  Reader@Example.com '));
  await expect('/recipients', 409, 'POST', recipient('reader@example.com'));
  assert.equal((await expect('/dashboard', 200)).activeRecipients, 1);
  const path = '/recipients/' + person.id;
  await expect(path, 200, 'PATCH', {status: 'inactive'});
  assert.equal((await expect('/dashboard', 200)).activeRecipients, 0);
  const unsubscribed = await expect(path, 200, 'PATCH', {status: 'unsubscribed'});
  assert.ok(unsubscribed.unsubscribed_at);
  assert.equal(unsubscribed.consent_source, 'Test opt-in form');
  await expect(path, 409, 'PATCH', {status: 'active'});
  const input = csv('email,consent_source,consented_at,status', 'READER@example.com,form,2025-01-01,active\nsecond@example.com,,,inactive');
  const report = await expect('/recipients/import/preview', 200, 'POST', input);
  assert.deepEqual([report.valid, report.duplicates], [1, 1]);
  await expect('/recipients/import/commit', 409, 'POST', input);
  await expect('/recipients/import/commit', 200, 'POST', json([{email: 'second@example.com', status: 'inactive'}]));
  const list = await expect('/recipients?status=unsubscribed', 200);
  assert.equal(list.rows[0].id, person.id);
  assert.equal((await expect('/dashboard', 200)).activeRecipients, 0);
});

test('HTML preview escapes markup and plain text preserves the actual word and definition', async () => {
  const value = word('Ambiguous', '<img src=x onerror=alert(1)> Open to more than one interpretation.');
  const record = await expect('/words', 201, 'POST', value);
  const params = new URLSearchParams({wordId: record.id, subject: '<script>fake subject</script>'});
  const preview = await expect('/email/preview?' + params, 200);
  assert.match(preview.html, /&lt;img/);
  assert.match(preview.html, /&lt;script&gt;fake subject/);
  assert.doesNotMatch(preview.html, /<img|<script/);
  assert.match(preview.html, /name="color-scheme" content="light dark"/);
  assert.match(preview.html, /@media \(prefers-color-scheme: dark\)/);
  assert.ok(preview.html.includes('[data-ogsc] .email-card'));
  assert.match(preview.html, /class="email-card"[^>]*bgcolor="#fffdf7"/);
  assert.match(preview.text, /Ambiguous/);
  assert.ok(preview.text.includes(value.real_definition));
  assert.ok(preview.text.includes('A personal unsubscribe link will appear in the delivered email.'));
  assert.equal((await expect('/history', 200)).total, 0);
});

test('production ignores the mock binding and spoofed identity on every admin route', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const cases = [
    ['/dashboard'], ['/words'], ['/words', 'POST'], ['/words/' + id], ['/words/' + id, 'PATCH'], ['/words/' + id, 'DELETE'],
    ['/words/approve-all', 'POST'],
    ...['approve', 'reject', 'restore-draft'].map(action => ['/words/' + id + '/' + action, 'POST']),
    ...['preview', 'commit'].map(action => ['/words/import/' + action, 'POST']),
    ['/recipients'], ['/recipients', 'POST'], ['/recipients/' + id, 'PATCH'],
    ...['preview', 'commit'].map(action => ['/recipients/import/' + action, 'POST']),
    ['/email/preview'], ['/history'], ['/settings'], ['/settings', 'PATCH'],
  ];
  for (const [path, method] of cases) {
    const result = await request(production, path, method, undefined, {'Cf-Access-Authenticated-User-Email': admin});
    assert.equal(result.status, 401, `${method ?? 'GET'} ${path}`);
  }
  assert.equal((await request(production, '/health')).status, 200);
  assert.equal((await request(production, '/dashboard', 'GET', undefined, {'Cf-Access-Jwt-Assertion': 'invalid-token'})).status, 401);
});

test('Access JWT verifies signature, issuer, audience, expiration and email allowlist', async t => {
  const {privateKey, publicKey} = await generateKeyPair('RS256', {extractable: true});
  const wrongKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = {...await exportJWK(publicKey), kid: 'access-key', alg: 'RS256', use: 'sig'};
  const mocked = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), issuer + '/cdn-cgi/access/certs');
    return Response.json({keys: [jwk]});
  });
  async function call(overrides = {}, key = privateKey) {
    const token = await new SignJWT({email: admin, sub: 'access-user', iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1000) + 60, ...overrides})
      .setProtectedHeader({alg: 'RS256', kid: 'access-key'}).sign(key);
    // An authenticated request reaches routing and gets a 404 for this unknown route.
    return (await productionWorker.fetch(new Request(origin + '/api/unknown', {headers: {'Cf-Access-Jwt-Assertion': token}}), bindings)).status;
  }
  assert.equal(await call(), 404);
  assert.equal(await call({email: 'not-an-admin@example.com'}), 403);
  assert.equal(await call({iss: 'https://other-team.cloudflareaccess.com'}), 401);
  assert.equal(await call({aud: 'other-app'}), 401);
  assert.equal(await call({exp: 1}), 401);
  assert.equal(await call({}, wrongKey), 401);
  assert.ok(mocked.mock.callCount() >= 1);
});

test('mutations reject cross-origin, missing-origin, non-JSON and oversize requests', async () => {
  await expect('/words', 403, 'POST', word('Origin test'), {Origin: 'https://example.org'});
  const missing = await local.dispatchFetch(origin + '/api/words', {method: 'POST', body: JSON.stringify(word('Origin test'))});
  assert.equal(missing.status, 403);
  await expect('/words', 415, 'POST', word('Type test'), {'Content-Type': 'text/plain'});
  await expect('/words', 413, 'POST', word('Limit test', 'x'.repeat(27000)));
});

test('bulk approval covers all pages, preserves non-drafts, and is safe to retry', async () => {
  const drafts = Array.from({length: 25}, (_, index) => word('Bulk draft ' + index));
  await expect('/words/import/commit', 200, 'POST', {format: 'json', content: JSON.stringify(drafts)});
  const rejected = await expect('/words', 201, 'POST', word('Bulk excluded'));
  await expect('/words/' + rejected.id + '/reject', 200, 'POST');
  const before = await expect('/dashboard', 200);
  assert.ok(before.draft > 20);
  await expect('/words/approve-all', 403, 'POST', undefined, {Origin: 'https://elsewhere.example'});
  assert.deepEqual(await expect('/words/approve-all?search=unmatched&page=2', 200, 'POST'), {approved: before.draft});
  const after = await expect('/dashboard', 200);
  assert.equal(after.draft, 0);
  assert.equal(after.approved, before.approved + before.draft);
  assert.equal(after.rejected, before.rejected);
  assert.equal(after.sent, before.sent);
  assert.deepEqual(await expect('/words/approve-all', 200, 'POST'), {approved: 0});
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='word.approve-all'").first('count'), 1);
});

test('a public unsubscribe link requires confirmation and stops future delivery eligibility', async () => {
  const person = await expect('/recipients', 201, 'POST', recipient('unsubscribe@example.test'));
  const another = await expect('/recipients', 201, 'POST', recipient('keep-subscribed@example.test'));
  const before = await expect('/dashboard', 200);
  const link = await createUnsubscribeUrl(unsubscribeOrigin, person.id, unsubscribeKey);

  const landing = await local.dispatchFetch(link.href);
  assert.equal(landing.status, 200);
  assert.equal(landing.headers.get('Cache-Control'), 'no-store');
  assert.equal(landing.headers.get('Referrer-Policy'), 'strict-origin');
  const html = await landing.text();
  assert.match(html, /<form method="post" action="\/unsubscribe\?token=/);
  assert.doesNotMatch(html, /unsubscribe@example\.test/);
  assert.equal((await expect('/dashboard', 200)).activeRecipients, before.activeRecipients);
  assert.equal((await local.dispatchFetch(unsubscribeOrigin + '/api/recipients')).status, 404);
  assert.equal((await local.dispatchFetch(link.href, {method: 'POST', headers: {Origin: 'https://other.example.test'}})).status, 403);

  const forged = await createUnsubscribeUrl(unsubscribeOrigin, person.id, randomBytes(32).toString('hex'));
  assert.equal((await local.dispatchFetch(forged.href, {method: 'POST', headers: {Origin: unsubscribeOrigin}})).status, 400);
  const expired = new URL(link);
  expired.searchParams.set('token', await new SignJWT({})
    .setProtectedHeader({alg: 'HS256', typ: 'JWT'})
    .setIssuer('word-of-the-day/unsubscribe').setAudience('word-of-the-day-recipients')
    .setSubject(person.id).setIssuedAt(1).setExpirationTime(2)
    .sign(Buffer.from(unsubscribeKey, 'hex')));
  assert.equal((await local.dispatchFetch(expired.href)).status, 400);

  const submit = () => local.dispatchFetch(link.href, {method: 'POST', headers: {Origin: unsubscribeOrigin}, redirect: 'manual'});
  const response = await submit();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/unsubscribed');
  const success = await local.dispatchFetch(new URL(response.headers.get('Location'), link).href);
  assert.match(await success.text(), /This email subscription is no longer active/);

  const stored = () => db.prepare('SELECT status, unsubscribed_at FROM recipients WHERE id = ?').bind(person.id).first();
  const updated = await stored();
  assert.equal(updated.status, 'unsubscribed');
  assert.ok(updated.unsubscribed_at);
  assert.equal((await expect('/dashboard', 200)).activeRecipients, before.activeRecipients - 1);
  assert.equal(await db.prepare('SELECT status FROM recipients WHERE id = ?').bind(another.id).first('status'), 'active');
  await expect('/recipients/' + person.id, 409, 'PATCH', {status: 'active'});
  assert.equal((await submit()).status, 303);
  assert.deepEqual(await stored(), updated);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='recipient.public-unsubscribe' AND subject_id=?")
    .bind(person.id).first('count'), 1);
});
