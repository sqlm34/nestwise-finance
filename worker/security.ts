import { uuid } from './contract';
export const maxBodyBytes = 16384;
export type ServiceKey = { connectionId: string; secret: string; notBefore: number; expiresAt: number };
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export async function limitedText(request: Request): Promise<string> {
  if (!request.body) throw new Error('invalid_body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function authenticateEvent(request: Request, raw: string, keyJson: string, now = Math.floor(Date.now() / 1000)) {
  const connection = request.headers.get('x-nw-connection') ?? '';
  const keyId = request.headers.get('x-nw-key-id') ?? '';
  const timestamp = request.headers.get('x-nw-timestamp') ?? '';
  const nonce = request.headers.get('x-nw-nonce') ?? '';
  const signature = request.headers.get('x-nw-signature') ?? '';
  if (!/^[a-z0-9-]{1,64}$/.test(connection) || !/^[a-z0-9-]{1,64}$/.test(keyId)
    || !/^[0-9]{10}$/.test(timestamp) || !uuid.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)
    || Math.abs(now - Number(timestamp)) > 300) throw new Error('unauthorized');
  const keys = JSON.parse(keyJson) as Record<string, ServiceKey>;
  const key = Object.hasOwn(keys, keyId) ? keys[keyId] : undefined;
  if (!key || key.connectionId !== connection || !Number.isFinite(key.notBefore) || !Number.isFinite(key.expiresAt)
    || now < key.notBefore || now >= key.expiresAt || !/^[0-9a-f]{64,128}$/.test(key.secret)
    || key.secret.length % 2 !== 0) throw new Error('unauthorized');
  const material = Uint8Array.from(key.secret.match(/../g)!, h => parseInt(h, 16));
  const cryptoKey = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const url = new URL(request.url);
  const canonical = ['v1', request.method, url.pathname + url.search, connection, keyId, timestamp, nonce, await sha256(raw)].join('\n');
  const valid = await crypto.subtle.verify('HMAC', cryptoKey,
    Uint8Array.from(signature.match(/../g)!, h => parseInt(h, 16)), new TextEncoder().encode(canonical));
  if (!valid) throw new Error('unauthorized');
  return { connection, nonce, timestamp: Number(timestamp) };
}
