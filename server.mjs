#!/usr/bin/env node
/**
 * Unscrewed MVP - Plain Node HTTP server.
 * Zero dependencies. Serves static files from ./public plus the synthetic fixture image.
 * Bind: 127.0.0.1:4173 (configurable via PORT env).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './lib/live-meta.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(__dirname, 'public');
const SHELF_IMAGE = join(__dirname, 'fixtures', 'synthetic-shelf.png');
const HOST = '127.0.0.1';
const PORT = parseInt(process.env.PORT || '4173', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico':  'image/x-icon',
};

export function createApp(opts) {
  const api = createApiHandler(opts);
  return async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (await api(req, res, url.pathname)) return;
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;

  // Security: resolve and require the result to stay inside the public root
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end('Bad request'); return; }
  if (decoded.includes('\0')) { res.writeHead(400); res.end('Bad request'); return; }
  const filePath = decoded === '/fixtures/synthetic-shelf.png' ? SHELF_IMAGE : resolve(PUBLIC, '.' + decoded);
  if (filePath !== SHELF_IMAGE && !filePath.startsWith(PUBLIC + sep)) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer(createApp()).listen(PORT, HOST, () => {
    console.log(`Unscrewed MVP -> http://${HOST}:${PORT} (${process.env.META_API_KEY ? 'live' : 'sample only'})`);
  });
}
