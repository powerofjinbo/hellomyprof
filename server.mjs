import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateProfessor, rankAuthors } from './src/prof-evaluator.mjs';
import { buildCollaborationInsights } from './src/collaboration-insights.mjs';
import { enrichProfessorWebPresence } from './src/web-enrichment.mjs';

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

const reportCache = new Map();
const openAlexJsonCache = new Map();

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

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

function normalizeQuery(body = {}) {
  return {
    professorName: String(body.professorName || '').trim(),
    researchField: String(body.researchField || '').trim(),
    institutionName: String(body.institutionName || '').trim(),
    audienceLevel: String(body.audienceLevel || 'all').trim() || 'all',
    apiEmail: String(body.apiEmail || '').trim(),
    apiKey: String(body.apiKey || '').trim(),
  };
}

function appendApiSettings(url, query) {
  const nextUrl = new URL(url);
  if (query.apiEmail) {
    nextUrl.searchParams.set('mailto', query.apiEmail);
  }
  if (query.apiKey) {
    nextUrl.searchParams.set('api_key', query.apiKey);
  }
  return nextUrl.toString();
}

async function fetchJson(url, query) {
  const requestUrl = appendApiSettings(url, query);
  if (openAlexJsonCache.has(requestUrl)) {
    return openAlexJsonCache.get(requestUrl);
  }

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Professor Research Opportunity Evaluator/0.1',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  openAlexJsonCache.set(requestUrl, payload);
  return payload;
}

async function fetchAuthorDetails(authorId, query) {
  const authorKey = String(authorId).split('/').pop();
  const url = new URL(`https://api.openalex.org/authors/${authorKey}`);
  return fetchJson(url, query);
}

async function fetchWorks(author, query) {
  const works = [];
  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    const url = new URL(author.works_api_url || 'https://api.openalex.org/works');
    url.searchParams.set('sort', 'publication_date:desc');
    url.searchParams.set('per-page', '50');
    url.searchParams.set('page', String(pageNumber));
    const data = await fetchJson(url, query);
    works.push(...(data.results || []));
    if (!data.results || data.results.length < 50) {
      break;
    }
  }
  return works;
}

function reportCacheKey(authorId, query) {
  return JSON.stringify({
    authorId,
    researchField: query.researchField,
    institutionName: query.institutionName,
    audienceLevel: query.audienceLevel,
  });
}

async function handleSearch(request, response) {
  const query = normalizeQuery(await readJsonBody(request));
  if (!query.professorName) {
    errorJson(response, 400, 'Professor name is required.');
    return;
  }

  const url = new URL('https://api.openalex.org/authors');
  url.searchParams.set('search', query.professorName);
  url.searchParams.set('per-page', '8');

  const data = await fetchJson(url, query);
  const matches = rankAuthors(data.results || [], query).map((author) => ({
    ...author,
    matchScore: clamp(Number(author.matchScore || 0), 0, 100),
  }));

  json(response, 200, { matches });
}

async function handleReport(request, response) {
  const body = await readJsonBody(request);
  const query = normalizeQuery(body.query);
  const authorId = String(body.authorId || '').trim();

  if (!authorId) {
    errorJson(response, 400, 'Author ID is required.');
    return;
  }

  const cacheKey = reportCacheKey(authorId, query);
  if (reportCache.has(cacheKey)) {
    json(response, 200, { report: reportCache.get(cacheKey) });
    return;
  }

  const author = await fetchAuthorDetails(authorId, query);
  const works = await fetchWorks(author, query);
  const websiteSignals = await enrichProfessorWebPresence({ author, query, works });
  const collaborationInsights = await buildCollaborationInsights({
    author,
    works,
    fetchAuthorById: (collaboratorId) => fetchAuthorDetails(collaboratorId, query),
  });
  const report = evaluateProfessor({
    author,
    works,
    researchField: query.researchField,
    audience: query.audienceLevel,
    institutionHint: query.institutionName,
    websiteSignals,
    collaborationInsights,
  });

  reportCache.set(cacheKey, report);
  json(response, 200, { report });
}

async function handleApi(request, response) {
  try {
    if (request.method === 'GET' && request.url === '/api/health') {
      json(response, 200, { ok: true });
      return true;
    }

    if (request.method === 'POST' && request.url === '/api/search') {
      await handleSearch(request, response);
      return true;
    }

    if (request.method === 'POST' && request.url === '/api/report') {
      await handleReport(request, response);
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
