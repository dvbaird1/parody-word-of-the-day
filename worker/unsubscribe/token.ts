import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

const recipientId = z.uuid();
const purpose = 'word-of-the-day/unsubscribe';
const audience = 'word-of-the-day-recipients';

function signingKey(secret: string | undefined) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) throw new Error('Unsubscribe signing key is unavailable.');
  return Uint8Array.from(secret.match(/../g)!, byte => Number.parseInt(byte, 16));
}

export async function createUnsubscribeUrl(origin: string, id: string, secret: string): Promise<URL> {
  const host = new URL(origin);
  if (host.protocol !== 'https:' || host.origin !== origin) throw new Error('Use the HTTPS unsubscribe origin.');
  const token = await new SignJWT({})
    .setProtectedHeader({alg: 'HS256', typ: 'JWT'})
    .setIssuer(purpose)
    .setAudience(audience)
    .setSubject(recipientId.parse(id))
    .setIssuedAt()
    .setExpirationTime('1 year')
    .sign(signingKey(secret));
  const url = new URL('/unsubscribe', host);
  url.searchParams.set('token', token);
  return url;
}

export async function verifyUnsubscribeToken(token: string, secret: string | undefined): Promise<string | null> {
  const key = signingKey(secret);
  if (token.length > 512 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  try {
    const {payload} = await jwtVerify(token, key, {
      algorithms: ['HS256'], typ: 'JWT', issuer: purpose, audience,
      requiredClaims: ['sub', 'iat', 'exp'], maxTokenAge: '1 year',
    });
    return recipientId.safeParse(payload.sub).data ?? null;
  } catch {
    return null;
  }
}
