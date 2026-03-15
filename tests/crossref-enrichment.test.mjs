import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupCrossrefWork, enrichTopWorksWithCrossref } from '../src/crossref-enrichment.mjs';

test('lookupCrossrefWork extracts journal and funding info', async () => {
  const mockWork = {
    message: {
      title: ['Attention Is All You Need'],
      'container-title': ['Advances in Neural Information Processing Systems'],
      publisher: 'NeurIPS',
      type: 'proceedings-article',
      'references-count': 42,
      'is-referenced-by-count': 98000,
      subject: ['Computer Science', 'Machine Learning'],
      funder: [{ name: 'Google Research', award: ['2017-001'] }],
    },
  };

  const fetchImpl = async () => ({
    ok: true,
    json: async () => mockWork,
  });

  const result = await lookupCrossrefWork('10.5555/3295222.3295349', fetchImpl);

  assert.ok(result);
  assert.equal(result.journal, 'Advances in Neural Information Processing Systems');
  assert.equal(result.publisher, 'NeurIPS');
  assert.equal(result.citedByCount, 98000);
  assert.equal(result.fundingInfo[0].name, 'Google Research');
});

test('lookupCrossrefWork returns null for invalid DOI', async () => {
  const result = await lookupCrossrefWork('not-a-doi');
  assert.equal(result, null);
});

test('lookupCrossrefWork handles DOI URL format', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      message: {
        title: ['Test Paper'],
        'container-title': ['Test Journal'],
        publisher: 'Test Publisher',
        'references-count': 10,
        'is-referenced-by-count': 50,
      },
    }),
  });

  const result = await lookupCrossrefWork('https://doi.org/10.1234/test', fetchImpl);
  assert.ok(result);
  assert.equal(result.doi, '10.1234/test');
});

test('enrichTopWorksWithCrossref adds crossref data to works', async () => {
  const topWorks = [
    { title: 'Paper A', link: 'https://doi.org/10.1234/a', citations: 100 },
    { title: 'Paper B', link: 'https://example.com/paper-b', citations: 50 },
  ];

  const fetchImpl = async (url) => {
    if (String(url).includes('10.1234')) {
      return {
        ok: true,
        json: async () => ({
          message: {
            title: ['Paper A'],
            'container-title': ['Nature'],
            publisher: 'Springer',
            'references-count': 30,
            'is-referenced-by-count': 100,
          },
        }),
      };
    }
    return { ok: false };
  };

  const result = await enrichTopWorksWithCrossref(topWorks, fetchImpl);
  assert.equal(result.length, 2);
  assert.ok(result[0].crossref);
  assert.equal(result[0].crossref.journal, 'Nature');
  assert.equal(result[1].crossref, undefined);
});
