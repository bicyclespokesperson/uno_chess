import { readFileSync, statSync } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

/** Serves the built frontend. Unknown paths get index.html (the app routes with #hashes, so this is just friendliness). */
export function staticHandler(root: string): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const base = path.resolve(root);
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      return false;
    }
    let file = path.resolve(base, `.${pathname}`);
    if (file !== base && !file.startsWith(base + path.sep)) return false;
    try {
      if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
      statSync(file);
    } catch {
      file = path.join(base, 'index.html');
    }
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      return false;
    }
    const hashedAsset = file.startsWith(path.join(base, 'assets') + path.sep);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
