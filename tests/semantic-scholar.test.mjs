import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSemanticScholar } from '../src/semantic-scholar.mjs';

test('lookupSemanticScholar returns profile when name matches', async () => {
  const mockResponse = {
    data: [
      {
        authorId: '12345',
        name: 'Fei-Fei Li',
        url: 'https://www.semanticscholar.org/author/12345',
        homepage: 'https://profiles.stanford.edu/fei-fei-li',
        hIndex: 120,
        citationCount: 150000,
        paperCount: 800,
        externalIds: { ORCID: '0000-0003-1234-5678' },
      },
    ],
  };

  const fetchImpl = async () => ({
    ok: true,
    json: async () => mockResponse,
  });

  const result = await lookupSemanticScholar({
    name: 'Fei-Fei Li',
    orcid: '',
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.authorId, '12345');
  assert.equal(result.name, 'Fei-Fei Li');
  assert.equal(result.citationCount, 150000);
  assert.equal(result.homepage, 'https://profiles.stanford.edu/fei-fei-li');
  assert.equal(result.source, 'Semantic Scholar');
});

test('lookupSemanticScholar returns null for unmatched name', async () => {
  const mockResponse = {
    data: [
      {
        authorId: '99999',
        name: 'John Smith',
        url: 'https://www.semanticscholar.org/author/99999',
        hIndex: 5,
        citationCount: 100,
        paperCount: 10,
        externalIds: {},
      },
    ],
  };

  const fetchImpl = async () => ({
    ok: true,
    json: async () => mockResponse,
  });

  const result = await lookupSemanticScholar({
    name: 'Fei-Fei Li',
    orcid: '',
    fetchImpl,
  });

  assert.equal(result, null);
});

test('lookupSemanticScholar matches via ORCID', async () => {
  const mockResponse = {
    data: [
      {
        authorId: '55555',
        name: 'F. Li',
        url: 'https://www.semanticscholar.org/author/55555',
        hIndex: 90,
        citationCount: 80000,
        paperCount: 500,
        externalIds: { ORCID: '0000-0001-2345-6789' },
      },
    ],
  };

  const fetchImpl = async () => ({
    ok: true,
    json: async () => mockResponse,
  });

  const result = await lookupSemanticScholar({
    name: 'Fei-Fei Li',
    orcid: 'https://orcid.org/0000-0001-2345-6789',
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.authorId, '55555');
});

test('lookupSemanticScholar returns null for empty name', async () => {
  const result = await lookupSemanticScholar({ name: '' });
  assert.equal(result, null);
});
