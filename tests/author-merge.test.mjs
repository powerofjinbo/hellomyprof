import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAuthorMatches } from '../src/author-merge.mjs';

test('buildAuthorMatches merges close OpenAlex variants for the same professor', () => {
  const matches = buildAuthorMatches(
    [
      {
        id: 'https://openalex.org/A1',
        display_name: 'Daniel Whiteson',
        display_name_alternatives: ['Whiteson, Daniel'],
        works_count: 120,
        cited_by_count: 10000,
        summary_stats: { h_index: 35 },
        last_known_institutions: [{ display_name: 'University of California, Irvine', type: 'education' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
      {
        id: 'https://openalex.org/A2',
        display_name: 'D. Whiteson',
        display_name_alternatives: ['Daniel Whiteson'],
        works_count: 140,
        cited_by_count: 11000,
        summary_stats: { h_index: 37 },
        last_known_institutions: [{ display_name: 'University of California, Irvine', type: 'education' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
    ],
    {
      professorName: 'Daniel Whiteson',
      researchField: 'particle physics',
      institutionName: 'University of California, Irvine',
    },
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].profileType, 'merged');
  assert.equal(matches[0].mergedProfileCount, 2);
  assert.deepEqual(matches[0].mergedAuthorIds.sort(), ['https://openalex.org/A1', 'https://openalex.org/A2']);
});

test('buildAuthorMatches suppresses same-name same-institution duplicates that survive initial clustering', () => {
  const matches = buildAuthorMatches(
    [
      {
        id: 'https://openalex.org/A1',
        display_name: 'Daniel Whiteson',
        display_name_alternatives: ['Whiteson, Daniel'],
        works_count: 1,
        cited_by_count: 154,
        summary_stats: { h_index: 1 },
        last_known_institutions: [{ display_name: 'University of California, Irvine', type: 'education' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
      {
        id: 'https://openalex.org/A2',
        display_name: 'Daniel Whiteson',
        display_name_alternatives: ['D. Whiteson'],
        works_count: 6,
        cited_by_count: 60,
        summary_stats: { h_index: 3 },
        last_known_institutions: [{ display_name: 'University of California, Irvine', type: 'education' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
      {
        id: 'https://openalex.org/A3',
        display_name: 'Daniel Whiteson',
        display_name_alternatives: ['Whiteson, D'],
        works_count: 20,
        cited_by_count: 37,
        summary_stats: { h_index: 3 },
        last_known_institutions: [{ display_name: 'University of California, Irvine', type: 'education' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
      {
        id: 'https://openalex.org/A4',
        display_name: 'Daniel Whiteson',
        display_name_alternatives: ['D. Whiteson'],
        works_count: 2,
        cited_by_count: 358,
        summary_stats: { h_index: 1 },
        last_known_institutions: [{ display_name: 'Deutsches Elektronen-Synchrotron DESY', type: 'facility' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
    ],
    {
      professorName: 'Daniel Whiteson',
      researchField: 'particle physics',
      institutionName: 'University of California, Irvine',
    },
  );

  assert.equal(matches.length, 2);
  assert.equal(matches[0].profileType, 'merged');
  assert.equal(matches[0].mergedProfileCount, 3);
  assert.equal(matches[1].profileType, 'single');
  assert.equal(matches[1].works_count, 2);
});
