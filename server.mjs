#!/usr/bin/env node
/**
 * PackBack MVP - Plain Node HTTP server.
 * Zero dependencies. Serves static files from ./public plus the synthetic fixture image.
 * Bind: 127.0.0.1:4173 (configurable via PORT env).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(__dirname, 'public');
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
  '.ico':  'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;

  // Security: no directory traversal
  if (pathname.includes('..')) {
    res.writeHead(400); res.end('Bad request'); return;
  }

  const filePath = pathname === '/fixtures/synthetic-shelf.png' ? SHELF_IMAGE : join(PUBLIC, pathname);
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PackBack MVP -> http://${HOST}:${PORT}`);
});
