import { createHmac, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

export function constantTimeEqual(a: string, b: string) {
  // Hash to fixed lengths so comparison itself never depends on a secret's length.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export function signToken(payload: unknown, secret: string, ttlSeconds = 3600) {
  const data = Buffer.from(JSON.stringify({ payload, expires: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  return data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
}
export function verifyToken<T>(token: string, secret: string): T | null {
  try {
    const [data, signature, extra] = token.split('.');
    if (!data || !signature || extra || !constantTimeEqual(signature, createHmac('sha256', secret).update(data).digest('base64url'))) return null;
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString());
    return typeof parsed.expires === 'number' && parsed.expires > Date.now() ? parsed.payload as T : null;
  } catch { return null; }
}
// OAuth access tokens are encrypted as well as signed; readable cookies never contain credentials.
export function seal(value: string, secret: string) {
  const iv = randomBytes(12), key = createHash('sha256').update(secret).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64url')).join('.');
}
export function unseal(value: string, secret: string) {
  const [iv, tag, content] = value.split('.').map(s => Buffer.from(s, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8');
}
export function cookie(request: Request, name: string) {
  return (request.headers.get('cookie') ?? '').split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
export function sessionCookie(request: Request, token: string, maxAge = 28800, name = 'inlinecms-session', sameSite = 'Strict') {
  return `${name}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function validOrigin(request: Request, origin = new URL(request.url).origin) {
  return request.headers.get('origin') === origin;
}
export interface Session { user: string; accessToken?: string; branch?: string }
