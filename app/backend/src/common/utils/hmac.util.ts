import { createHmac } from 'crypto';

export interface HmacSignatureOptions {
  method: string;
  path: string;
  body?: string | Buffer;
  secretKey: string;
}

export interface HmacHeaders {
  'X-HMAC-Signature': string;
  'X-HMAC-Timestamp': string;
}

export function generateHmacSignature(options: HmacSignatureOptions): HmacHeaders {
  const { method, path, body = '', secretKey } = options;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const bodyString = typeof body === 'string' ? body : body.toString('utf-8');
  const payload = `${method}${path}${timestamp}${bodyString}`;

  const signature = createHmac('sha256', secretKey)
    .update(payload, 'utf-8')
    .digest('hex');

  return {
    'X-HMAC-Signature': signature,
    'X-HMAC-Timestamp': timestamp,
  };
}
