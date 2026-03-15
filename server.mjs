import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProfessorReport, searchAuthors } from './src/backend-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const TEXT_DECODER = new TextDecoder();
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
}

function errorJson(response, statusCode, message) {
  json(response, statusCode, { error: message });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    const size = chunks.reduce((sum, item) => sum + item.length, 0);
    if (size > 1_000_000) {
      throw new Error('Request body is too large.');
    }
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(TEXT_DECODER.decode(Buffer.concat(chunks)));
}

async function handleApi(request, response) {
  try {
    if (request.method === 'GET' && request.url === '/api/health') {
      json(response, 200, { ok: true });
      return true;
    }

    if (request.method === 'POST' && request.url === '/api/search') {
      json(response, 200, await searchAuthors(await readJsonBody(request)));
      return true;
    }

    if (request.method === 'POST' && request.url === '/api/report') {
      json(response, 200, await buildProfessorReport(await readJsonBody(request)));
      return true;
    }
  } catch (error) {
    errorJson(response, 500, error.message || 'Server error.');
    return true;
  }

  return false;
}

function resolveStaticPath(requestUrl) {
  const pathname = new URL(requestUrl, `http://127.0.0.1:${PORT}`).pathname;
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const targetPath = path.resolve(__dirname, `.${relativePath}`);
  if (!targetPath.startsWith(__dirname)) {
    return null;
  }
  return targetPath;
}

async function handleStatic(request, response) {
  const targetPath = resolveStaticPath(request.url || '/');
  if (!targetPath) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(targetPath);
    const contentType = STATIC_TYPES[path.extname(targetPath)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const handled = await handleApi(request, response);
  if (!handled) {
    await handleStatic(request, response);
  }
});

server.listen(PORT, () => {
  process.stdout.write(`Professor evaluator server running on http://localhost:${PORT}\n`);
});
