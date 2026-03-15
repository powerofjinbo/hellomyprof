import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lookupGoogleScholar } from '../src/google-scholar.mjs';

test('lookupGoogleScholar returns matched SearchAPI profile data', async () => {
  let callCount = 0;
  const fetchImpl = async (url) => {
    callCount += 1;
    const requestUrl = new URL(url);

    if (requestUrl.searchParams.get('engine') === 'google_scholar') {
      return {
        ok: true,
        json: async () => ({
          profiles: [
            {
              name: 'Daniel Whiteson',
              author_id: 'scholar123',
              link: 'https://scholar.google.com/citations?user=scholar123&hl=en',
              affiliations: 'University of California, Irvine',
              email: 'uci.edu',
              cited_by: { value: 3200 },
              interests: ['Particle physics', 'Machine learning'],
            },
          ],
        }),
      };
    }

    if (requestUrl.searchParams.get('engine') === 'google_scholar_author') {
      return {
        ok: true,
        json: async () => ({
          author: {
            name: 'Daniel Whiteson',
            affiliations: 'University of California, Irvine',
            email: 'uci.edu',
            interests: [{ title: 'Particle physics' }, { title: 'Data analysis' }],
          },
          cited_by: {
            table: {
              rows: [
                { metric: 'Citations', all: 3210 },
                { metric: 'H-index', all: 27 },
                { metric: 'i10-index', all: 55 },
              ],
            },
          },
          co_authors: [
            { name: 'Alice Example', affiliations: 'CERN', author_id: 'alice123' },
            { name: 'Bob Example', affiliations: 'UC Irvine', author_id: 'bob456' },
          ],
          articles: [
            { title: 'A paper', cited_by: { value: 120 }, year: 2025 },
          ],
        }),
      };
    }

    throw new Error(`Unexpected URL ${requestUrl.toString()}`);
  };

  const result = await lookupGoogleScholar({
    name: 'Daniel Whiteson',
    institution: 'University of California, Irvine',
    researchField: 'particle physics',
    fetchImpl,
    env: { SEARCHAPI_API_KEY: 'test-key' },
  });

  assert.equal(callCount, 2);
  assert.ok(result);
  assert.equal(result.status, 'matched');
  assert.equal(result.provider, 'SearchAPI');
  assert.equal(result.authorId, 'scholar123');
  assert.equal(result.citationCount, 3210);
  assert.equal(result.hIndex, 27);
  assert.equal(result.i10Index, 55);
  assert.equal(result.coAuthors.length, 2);
  assert.equal(result.articleSample.length, 1);
});

test('lookupGoogleScholar reports blocked direct access when Scholar redirects to login', async () => {
  const fetchImpl = async () => ({
    status: 302,
    headers: {
      get(key) {
        return key === 'location' ? 'https://accounts.google.com/Login' : null;
      },
    },
    text: async () => '',
  });

  const result = await lookupGoogleScholar({
    name: 'Daniel Whiteson',
    institution: 'University of California, Irvine',
    researchField: 'particle physics',
    fetchImpl,
    env: {},
  });

  assert.ok(result);
  assert.equal(result.status, 'blocked');
  assert.equal(result.provider, 'direct');
  assert.match(result.note, /login flow/i);
});
