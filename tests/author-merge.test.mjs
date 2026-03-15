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
  assert.deepEqual(matches[0].mergedAuthorIds.sort(), [
    'https://openalex.org/A1',
    'https://openalex.org/A2',
    'https://openalex.org/A3',
  ]);
  assert.equal(matches[1].profileType, 'single');
  assert.equal(matches[1].id, 'https://openalex.org/A4');
});

test('buildAuthorMatches merges initial-only name variants without explicit alternative names', () => {
  const matches = buildAuthorMatches(
    [
      {
        id: 'https://openalex.org/A10',
        display_name: 'Daniel Whiteson',
        works_count: 28,
        cited_by_count: 1800,
        summary_stats: { h_index: 24 },
        last_known_institutions: [{ display_name: 'University of California, Irvine', type: 'education' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
      {
        id: 'https://openalex.org/A11',
        display_name: 'D. Whiteson',
        works_count: 7,
        cited_by_count: 140,
        summary_stats: { h_index: 5 },
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
  assert.deepEqual(matches[0].mergedAuthorIds.sort(), ['https://openalex.org/A10', 'https://openalex.org/A11']);
});

test('buildAuthorMatches does not merge same-name variants across different institutions', () => {
  const matches = buildAuthorMatches(
    [
      {
        id: 'https://openalex.org/A20',
        display_name: 'Daniel Whiteson',
        display_name_alternatives: ['D. Whiteson'],
        works_count: 25,
        cited_by_count: 1800,
        summary_stats: { h_index: 22 },
        last_known_institutions: [{ display_name: 'University of California, Irvine', type: 'education' }],
        topics: [{ display_name: 'Particle Physics' }],
      },
      {
        id: 'https://openalex.org/A21',
        display_name: 'D. Whiteson',
        works_count: 3,
        cited_by_count: 240,
        summary_stats: { h_index: 4 },
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
  assert.equal(matches[0].profileType, 'single');
  assert.equal(matches[1].profileType, 'single');
});

test('buildAuthorMatches respects secondary affiliations when institutions overlap', () => {
  const matches = buildAuthorMatches(
    [
      {
        id: 'https://openalex.org/A30',
        display_name: 'Daniel Whiteson',
        works_count: 25,
        cited_by_count: 1800,
        summary_stats: { h_index: 22 },
        last_known_institutions: [{ display_name: 'Brookhaven National Laboratory', type: 'facility' }],
        affiliations: [
          {
            institution: { display_name: 'University of California, Irvine', type: 'education' },
            years: [2025, 2026],
          },
        ],
        topics: [{ display_name: 'Particle Physics' }],
      },
      {
        id: 'https://openalex.org/A31',
        display_name: 'D. Whiteson',
        works_count: 4,
        cited_by_count: 90,
        summary_stats: { h_index: 3 },
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
});
