import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareProfessorReports,
  computeFieldAlignment,
  evaluateProfessor,
  rankAuthors,
} from '../src/prof-evaluator.mjs';

function makeAuthor(overrides = {}) {
  return {
    id: 'https://openalex.org/A123',
    display_name: 'Ada Lovelace',
    works_count: 120,
    cited_by_count: 14000,
    summary_stats: { h_index: 42 },
    last_known_institutions: [
      {
        display_name: 'Example University',
        type: 'education',
      },
    ],
    topics: [{ display_name: 'Machine Learning' }, { display_name: 'Computer Vision' }],
    x_concepts: [{ display_name: 'Artificial Intelligence' }],
    counts_by_year: [
      { year: new Date().getFullYear() - 2, works_count: 6 },
      { year: new Date().getFullYear() - 1, works_count: 8 },
      { year: new Date().getFullYear(), works_count: 5 },
      { year: new Date().getFullYear() - 3, works_count: 4 },
      { year: new Date().getFullYear() - 4, works_count: 4 },
      { year: new Date().getFullYear() - 5, works_count: 3 },
    ],
    works_api_url: 'https://api.openalex.org/works?filter=author.id:A123',
    ...overrides,
  };
}

function makeWork(overrides = {}) {
  return {
    display_name: 'Interpretable Vision Models',
    publication_year: new Date().getFullYear(),
    publication_date: `${new Date().getFullYear()}-02-10`,
    cited_by_count: 85,
    fwci: 2.5,
    citation_normalized_percentile: {
      value: 0.94,
      is_in_top_10_percent: true,
    },
    primary_location: {
      source: {
        display_name: 'Conference on Vision Systems',
        is_core: true,
      },
      landing_page_url: 'https://example.com/paper',
    },
    open_access: { is_oa: true },
    primary_topic: { display_name: 'Computer Vision' },
    topics: [{ display_name: 'Computer Vision' }, { display_name: 'Deep Learning' }],
    keywords: [{ display_name: 'Visual Recognition' }],
    authorships: [
      {
        author_position: 'first',
        is_corresponding: true,
        author: {
          id: 'https://openalex.org/A123',
        },
      },
      {
        author_position: 'middle',
        is_corresponding: false,
        author: {
          id: 'https://openalex.org/A456',
        },
      },
    ],
    ...overrides,
  };
}

test('field alignment increases when the query matches topic tokens', () => {
  const author = makeAuthor();
  const works = [makeWork()];

  const strongMatch = computeFieldAlignment(author, works, 'computer vision');
  const weakMatch = computeFieldAlignment(author, works, 'medieval literature');

  assert.ok(strongMatch > weakMatch);
  assert.ok(strongMatch > 0.6);
});

test('author ranking prefers exact institution and field alignment', () => {
  const matchingAuthor = makeAuthor();
  const offTargetAuthor = makeAuthor({
    id: 'https://openalex.org/A999',
    display_name: 'Ada Lovelace',
    last_known_institutions: [{ display_name: 'Other Institute', type: 'education' }],
    topics: [{ display_name: 'Bioinformatics' }],
  });

  const ranked = rankAuthors([offTargetAuthor, matchingAuthor], {
    professorName: 'Ada Lovelace',
    institutionName: 'Example University',
    researchField: 'computer vision',
  });

  assert.equal(ranked[0].id, matchingAuthor.id);
  assert.ok(ranked[0].matchScore > ranked[1].matchScore);
});

test('evaluation returns a strong phd score for a high-signal profile', () => {
  const author = makeAuthor();
  const works = [makeWork(), makeWork({ display_name: 'Foundation Models for Vision' }), makeWork({ display_name: 'Adaptive Visual Reasoning' })];

  const report = evaluateProfessor({
    author,
    works,
    researchField: 'computer vision',
  });

  assert.ok(report.overallScore >= 70);
  assert.ok(report.metrics.paperQuality >= 70);
  assert.ok(report.summaryText.includes('overall signal'));
});

test('verified source evidence is surfaced separately from publication metrics', () => {
  const author = makeAuthor();
  const works = [makeWork(), makeWork({ display_name: 'Adaptive Visual Reasoning' }), makeWork({ display_name: 'Foundation Models for Vision' })];

  const report = evaluateProfessor({
    author,
    works,
    researchField: 'computer vision',
    websiteSignals: {
      metrics: {
        evidenceCoverage: 76,
        verificationConfidence: 68,
      },
      confidence: 68,
      officialSources: [{ label: 'Official page via DBLP', url: 'https://example.edu/~ada', source: 'DBLP' }],
      verifiedPages: [{ title: 'Ada Lab', url: 'https://example.edu/lab', kind: 'lab', snippets: ['Current Ph.D. students and post-docs'] }],
      pages: [{ title: 'Ada Lab', url: 'https://example.edu/lab', kind: 'lab', snippets: ['Current Ph.D. students and post-docs'] }],
      highlights: ['An official lab or group page was found and used as a mentoring-context signal.'],
      caveats: [],
    },
  });

  assert.equal(report.metrics.evidenceCoverage, 76);
  assert.equal(report.metrics.verificationConfidence, 68);
  assert.equal(report.webSignals.officialSources.length, 1);
  assert.ok(report.summaryText.includes('Verified source coverage'));
});

test('comparison helper builds a leaderboard and dimension groups', () => {
  const baseline = evaluateProfessor({
    author: makeAuthor(),
    works: [makeWork(), makeWork({ display_name: 'Adaptive Visual Reasoning' })],
    researchField: 'computer vision',
    audience: 'all',
  });

  const challenger = evaluateProfessor({
    author: makeAuthor({
      id: 'https://openalex.org/A777',
      display_name: 'Grace Hopper',
      works_count: 80,
      cited_by_count: 5000,
      summary_stats: { h_index: 24 },
    }),
    works: [makeWork({ authorships: [{ author_position: 'middle', is_corresponding: false, author: { id: 'https://openalex.org/A777' } }] })],
    researchField: 'computer vision',
    audience: 'all',
  });

  const comparison = compareProfessorReports([baseline, challenger]);

  assert.equal(comparison.dimensions.length, 9);
  assert.equal(comparison.leaderboard.length, 2);
  assert.equal(comparison.dimensions[0].label, 'Overall');
  assert.equal(comparison.leaderboard[0].name, baseline.author.display_name);
});
