import { computeFieldAlignment, pickInstitution, rankAuthors } from './prof-evaluator.mjs';

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitName(value) {
  const tokens = normalizeName(value)
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return {
    first: tokens[0] || '',
    last: tokens.at(-1) || '',
  };
}

function exactish(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.84;
  const leftTokens = new Set(a.split(/\s+/));
  const rightTokens = new Set(b.split(/\s+/));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function nameVariantScore(author, queryName) {
  const variants = [author.display_name, ...(author.display_name_alternatives || [])];
  return variants.reduce((best, variant) => Math.max(best, exactish(variant, queryName)), 0);
}

function institutionScore(author, institutionHint) {
  return exactish(pickInstitution(author, institutionHint), institutionHint);
}

function hasInstitutionData(author) {
  return Boolean((author.last_known_institutions || []).length || (author.affiliations || []).length);
}

function shouldMerge(left, right, query) {
  const queryName = query.professorName || '';
  const leftName = splitName(left.display_name);
  const rightName = splitName(right.display_name);
  const sameLastName = leftName.last && leftName.last === rightName.last;
  const sameInitial = leftName.first?.[0] && leftName.first[0] === rightName.first?.[0];
  const strongQueryMatch = nameVariantScore(left, queryName) >= 0.72 && nameVariantScore(right, queryName) >= 0.72;
  const leftInstitutionMatch = institutionScore(left, query.institutionName);
  const rightInstitutionMatch = institutionScore(right, query.institutionName);
  const institutionAligned =
    !query.institutionName ||
    ((leftInstitutionMatch >= 0.72 || !hasInstitutionData(left)) && (rightInstitutionMatch >= 0.72 || !hasInstitutionData(right)));
  const fieldAligned =
    !query.researchField || (computeFieldAlignment(left, [], query.researchField || '') >= 0.35 && computeFieldAlignment(right, [], query.researchField || '') >= 0.35);

  return Boolean(sameLastName && sameInitial && strongQueryMatch && institutionAligned && fieldAligned);
}

export function dedupeWorks(works) {
  const seen = new Set();
  const merged = [];

  for (const work of works) {
    const key =
      work.id ||
      work.ids?.doi ||
      `${String(work.display_name || '').toLowerCase()}::${work.publication_year || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(work);
  }

  return merged;
}

function mergeCountsByYear(authors) {
  const byYear = new Map();
  for (const author of authors) {
    for (const row of author.counts_by_year || []) {
      const current = byYear.get(row.year) || { year: row.year, works_count: 0, cited_by_count: 0 };
      current.works_count += row.works_count || 0;
      current.cited_by_count += row.cited_by_count || 0;
      byYear.set(row.year, current);
    }
  }
  return Array.from(byYear.values()).sort((left, right) => left.year - right.year);
}

function bestDisplayName(authors, alternatives, preferredName = '') {
  const anchor = splitName(preferredName || authors[0]?.display_name || '');
  const candidates = Array.from(new Set([...authors.map((author) => author.display_name), ...alternatives])).filter((candidate) => {
    const parts = splitName(candidate);
    return parts.last === anchor.last && (!anchor.first?.[0] || parts.first?.[0] === anchor.first[0]);
  });

  if (preferredName) {
    const preferred = splitName(preferredName);
    if (preferred.last === anchor.last && (!anchor.first?.[0] || preferred.first?.[0] === anchor.first[0])) {
      return preferredName;
    }
  }

  return candidates
    .sort((left, right) => right.replace(/\./g, '').length - left.replace(/\./g, '').length || right.length - left.length)[0];
}

export function mergeAuthorProfiles(authors, mergedWorks = [], preferredName = '') {
  const sorted = authors
    .slice()
    .sort((left, right) => (right.works_count || 0) - (left.works_count || 0) || (right.cited_by_count || 0) - (left.cited_by_count || 0));
  const primary = sorted[0];
  const allTopics = new Map();
  const allInstitutions = new Map();
  const alternatives = new Set();

  for (const author of sorted) {
    alternatives.add(author.display_name);
    for (const value of author.display_name_alternatives || []) {
      alternatives.add(value);
    }
    for (const topic of author.topics || []) {
      const current = allTopics.get(topic.id || topic.display_name) || { ...topic, count: 0 };
      current.count += topic.count || 0;
      allTopics.set(topic.id || topic.display_name, current);
    }
    for (const institution of author.last_known_institutions || []) {
      allInstitutions.set(institution.id || institution.display_name, institution);
    }
  }

  const displayName = bestDisplayName(sorted, alternatives, preferredName);
  return {
    ...primary,
    id: `merged:${sorted.map((author) => author.id.split('/').pop()).join('+')}`,
    display_name: displayName || primary.display_name,
    display_name_alternatives: Array.from(alternatives),
    works_count: Math.max(mergedWorks.length, sorted.reduce((sum, author) => sum + (author.works_count || 0), 0)),
    cited_by_count: sorted.reduce((sum, author) => sum + (author.cited_by_count || 0), 0),
    summary_stats: {
      ...(primary.summary_stats || {}),
      h_index: Math.max(...sorted.map((author) => author.summary_stats?.h_index || 0)),
    },
    topics: Array.from(allTopics.values()).sort((left, right) => (right.count || 0) - (left.count || 0)).slice(0, 8),
    last_known_institutions: Array.from(allInstitutions.values()),
    counts_by_year: mergeCountsByYear(sorted),
    mergedAuthorIds: sorted.map((author) => author.id),
    mergedProfileCount: sorted.length,
  };
}

export function buildAuthorMatches(authors, query) {
  const ranked = rankAuthors(authors, query);
  const used = new Set();
  const matches = [];

  for (let index = 0; index < ranked.length; index += 1) {
    const author = ranked[index];
    if (used.has(author.id)) {
      continue;
    }

    const cluster = [author];
    for (let inner = index + 1; inner < ranked.length; inner += 1) {
      const candidate = ranked[inner];
      if (used.has(candidate.id)) {
        continue;
      }
      if (shouldMerge(author, candidate, query)) {
        cluster.push(candidate);
        used.add(candidate.id);
      }
    }

    if (cluster.length > 1) {
      const merged = mergeAuthorProfiles(cluster, [], query.professorName || '');
      matches.push({
        ...merged,
        matchScore: Math.max(...cluster.map((item) => item.matchScore || 0)),
        mergedProfileCount: cluster.length,
        profileType: 'merged',
      });
      used.add(author.id);
      continue;
    }

    matches.push({
      ...author,
      profileType: 'single',
      mergedProfileCount: 1,
    });
    used.add(author.id);
  }

  return matches.sort((left, right) => right.matchScore - left.matchScore || (right.cited_by_count || 0) - (left.cited_by_count || 0));
}
