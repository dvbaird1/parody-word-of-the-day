import { createRemoteJWKSet, jwtVerify } from 'jose';

declare const __LOCAL_DEV_BUILD__: boolean;
export type AuthBindings = {
  LOCAL_ADMIN_EMAIL?: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  ADMIN_EMAILS?: string;
};
type Identity = { email: string } | { status: 401 | 403 };
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticate(request: Request, env: AuthBindings): Promise<Identity> {
  if (typeof __LOCAL_DEV_BUILD__ !== 'undefined' && __LOCAL_DEV_BUILD__ && env.LOCAL_ADMIN_EMAIL) {
    return {email: env.LOCAL_ADMIN_EMAIL};
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const { ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: audience, ADMIN_EMAILS: admins } = env;
  if (!token || token.length > 8192 || !issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience || !admins) {
    return {status: 401};
  }
  try {
    let keys = keysets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
      keysets.set(issuer, keys);
    }
    const {payload} = await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'sub', 'email'] });
    if (typeof payload.email !== 'string') return {status: 401};
    const email = payload.email.trim().toLowerCase();
    if (!email) return {status: 401};
    return admins.split(',').some(admin => admin.trim().toLowerCase() === email) ? {email} : {status: 403};
  } catch {
    return {status: 401};
  }
}
