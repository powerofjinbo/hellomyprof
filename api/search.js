import { searchAuthors } from '../src/backend-core.mjs';

function parseBody(request) {
  if (!request.body) {
    return {};
  }

  if (typeof request.body === 'string') {
    return JSON.parse(request.body || '{}');
  }

  return request.body;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const result = await searchAuthors(parseBody(request));
    response.status(200).json(result);
  } catch (error) {
    response.status(500).json({ error: error.message || 'Server error.' });
  }
}
