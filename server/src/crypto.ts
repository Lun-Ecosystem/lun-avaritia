import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFrom(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('AVARITIA_SECRET_KEY doit faire 32 octets (en base64)');
  return key;
}

/** AES-256-GCM; the blob is `iv.tag.ciphertext`, each part in base64url. */
export function encrypt(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyBase64), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(blob: string, keyBase64: string): string {
  const [iv, tag, data] = blob.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Secret chiffré illisible');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyBase64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
