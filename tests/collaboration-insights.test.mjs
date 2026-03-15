import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCollaborationInsights } from '../src/collaboration-insights.mjs';

test('buildCollaborationInsights summarizes frequent and senior collaborators', async () => {
  const author = {
    id: 'https://openalex.org/A1',
    display_name: 'Ada Lovelace',
  };

  const works = [
    {
      display_name: 'Vision Models at Scale',
      publication_year: new Date().getFullYear(),
      cited_by_count: 120,
      authorships: [
        { author: { id: 'https://openalex.org/A1', display_name: 'Ada Lovelace' } },
        { author: { id: 'https://openalex.org/A2', display_name: 'Grace Hopper' } },
        { author: { id: 'https://openalex.org/A3', display_name: 'Alan Turing' } },
      ],
    },
    {
      display_name: 'Adaptive Visual Reasoning',
      publication_year: new Date().getFullYear() - 1,
      cited_by_count: 80,
      authorships: [
        { author: { id: 'https://openalex.org/A1', display_name: 'Ada Lovelace' } },
        { author: { id: 'https://openalex.org/A2', display_name: 'Grace Hopper' } },
      ],
    },
  ];

  const insights = await buildCollaborationInsights({
    author,
    works,
    fetchAuthorById: async (id) => {
      if (String(id).endsWith('A2')) {
        return {
          summary_stats: { h_index: 72 },
          cited_by_count: 68000,
          last_known_institutions: [{ display_name: 'Stanford University' }],
        };
      }
      return {
        summary_stats: { h_index: 18 },
        cited_by_count: 2200,
        last_known_institutions: [{ display_name: 'Example Institute' }],
      };
    },
  });

  assert.equal(insights.topCollaborators[0].name, 'Grace Hopper');
  assert.equal(insights.topCollaborators[0].workCount, 2);
  assert.ok(insights.metrics.repeatCollaboration > 0);
  assert.ok(insights.metrics.seniorCollaboratorSignal > 0);
  assert.equal(insights.histogram.length, 5);
});
