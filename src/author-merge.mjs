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

function sharedInitial(left, right) {
  if (!left || !right) return false;
  return left[0] === right[0];
}

function nameExactish(left, right) {
  const base = exactish(left, right);
  const leftName = splitName(left);
  const rightName = splitName(right);

  if (!leftName.last || leftName.last !== rightName.last || !sharedInitial(leftName.first, rightName.first)) {
    return base;
  }

  if (leftName.first === rightName.first && leftName.first) {
    return Math.max(base, 0.97);
  }

  if (leftName.first.length === 1 || rightName.first.length === 1) {
    return Math.max(base, 0.92);
  }

  return Math.max(base, 0.84);
}

function nameVariantScore(author, queryName) {
  const variants = [author.display_name, ...(author.display_name_alternatives || [])];
  return variants.reduce((best, variant) => Math.max(best, nameExactish(variant, queryName)), 0);
}

function authorNameVariants(author) {
  return Array.from(new Set([author.display_name, ...(author.display_name_alternatives || [])].filter(Boolean)));
}

function crossVariantScore(left, right) {
  const leftVariants = authorNameVariants(left);
  const rightVariants = authorNameVariants(right);
  let best = 0;
  for (const leftVariant of leftVariants) {
    for (const rightVariant of rightVariants) {
      best = Math.max(best, nameExactish(leftVariant, rightVariant));
    }
  }
  return best;
}

function institutionScore(author, institutionHint) {
  return exactish(pickInstitution(author, institutionHint), institutionHint);
}

function hasInstitutionData(author) {
  return Boolean((author.last_known_institutions || []).length || (author.affiliations || []).length);
}

function sameInstitutionScore(left, right) {
  if (!hasInstitutionData(left) || !hasInstitutionData(right)) {
    return 0;
  }
  return exactish(pickInstitution(left, ''), pickInstitution(right, ''));
}

function fieldScore(author, researchField) {
  return computeFieldAlignment(author, [], researchField || '');
}

function institutionsAligned(left, right, queryInstitution = '') {
  if (!hasInstitutionData(left) || !hasInstitutionData(right)) {
    return false;
  }

  const directSimilarity = sameInstitutionScore(left, right);
  if (!queryInstitution) {
    return directSimilarity >= 0.84;
  }

  const leftInstitutionMatch = institutionScore(left, queryInstitution);
  const rightInstitutionMatch = institutionScore(right, queryInstitution);
  return directSimilarity >= 0.84 || (leftInstitutionMatch >= 0.72 && rightInstitutionMatch >= 0.72);
}

function normalizeIdentityValue(value, prefixPattern = null) {
  if (!value) return '';
  let normalized = String(value).trim().toLowerCase();
  if (prefixPattern) {
    normalized = normalized.replace(prefixPattern, '');
  }
  return normalized;
}

function sharedExternalIdentity(left, right) {
  const leftIds = left.ids || {};
  const rightIds = right.ids || {};

  const leftOrcid = normalizeIdentityValue(leftIds.orcid, /^https?:\/\/orcid\.org\//);
  const rightOrcid = normalizeIdentityValue(rightIds.orcid, /^https?:\/\/orcid\.org\//);
  if (leftOrcid && rightOrcid && leftOrcid === rightOrcid) {
    return true;
  }

  const leftScopus = normalizeIdentityValue(leftIds.scopus);
  const rightScopus = normalizeIdentityValue(rightIds.scopus);
  if (leftScopus && rightScopus && leftScopus === rightScopus) {
    return true;
  }

  return false;
}

function shouldMerge(left, right, query) {
  const queryName = query.professorName || '';
  const leftName = splitName(left.display_name);
  const rightName = splitName(right.display_name);
  const sameLastName = leftName.last && leftName.last === rightName.last;
  const sameInitial = leftName.first?.[0] && leftName.first[0] === rightName.first?.[0];
  const leftQueryNameScore = nameVariantScore(left, queryName);
  const rightQueryNameScore = nameVariantScore(right, queryName);
  const variantSimilarity = crossVariantScore(left, right);
  const strongQueryMatch = leftQueryNameScore >= 0.72 && rightQueryNameScore >= 0.72;
  const exactDisplayDuplicate =
    variantSimilarity >= 0.96 &&
    (!queryName || (leftQueryNameScore >= 0.88 && rightQueryNameScore >= 0.88));
  const mutuallyAlignedInstitutions = institutionsAligned(left, right, query.institutionName || '');
  const leftFieldScore = fieldScore(left, query.researchField);
  const rightFieldScore = fieldScore(right, query.researchField);
  const fieldAligned = !query.researchField || (leftFieldScore >= 0.35 && rightFieldScore >= 0.35);

  return Boolean(
    sameLastName &&
      sameInitial &&
      mutuallyAlignedInstitutions &&
      fieldAligned &&
      (sharedExternalIdentity(left, right) ||
        strongQueryMatch ||
        exactDisplayDuplicate ||
        (variantSimilarity >= 0.84 && leftQueryNameScore >= 0.8 && rightQueryNameScore >= 0.8)),
  );
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

function countsByYearFromWorks(works) {
  const byYear = new Map();
  for (const work of works) {
    const year = Number(work.publication_year);
    if (!Number.isFinite(year)) {
      continue;
    }
    const current = byYear.get(year) || { year, works_count: 0, cited_by_count: 0 };
    current.works_count += 1;
    current.cited_by_count += work.cited_by_count || 0;
    byYear.set(year, current);
  }
  return Array.from(byYear.values()).sort((left, right) => left.year - right.year);
}

function flattenMergedAuthorIds(authors) {
  return Array.from(
    new Set(
      authors.flatMap((author) => {
        const mergedIds = Array.isArray(author.mergedAuthorIds) ? author.mergedAuthorIds : [];
        return mergedIds.length ? mergedIds : [author.id];
      }),
    ),
  );
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
  const maxWorksCount = Math.max(...sorted.map((author) => author.works_count || 0), 0);
  const maxCitations = Math.max(...sorted.map((author) => author.cited_by_count || 0), 0);
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
    id: `merged:${flattenMergedAuthorIds(sorted).map((authorId) => authorId.split('/').pop()).join('+')}`,
    display_name: displayName || primary.display_name,
    display_name_alternatives: Array.from(alternatives),
    works_count: mergedWorks.length ? Math.max(mergedWorks.length, maxWorksCount) : maxWorksCount,
    cited_by_count: maxCitations,
    summary_stats: {
      ...(primary.summary_stats || {}),
      h_index: Math.max(...sorted.map((author) => author.summary_stats?.h_index || 0)),
    },
    topics: Array.from(allTopics.values()).sort((left, right) => (right.count || 0) - (left.count || 0)).slice(0, 8),
    last_known_institutions: Array.from(allInstitutions.values()),
    counts_by_year: mergedWorks.length ? countsByYearFromWorks(mergedWorks) : mergeCountsByYear(sorted),
    mergedAuthorIds: flattenMergedAuthorIds(sorted),
    mergedProfileCount: sorted.length,
  };
}

function shouldSuppressDuplicate(left, right, query) {
  const leftName = splitName(left.display_name);
  const rightName = splitName(right.display_name);
  const sameLastName = leftName.last && leftName.last === rightName.last;
  const sameInitial = sharedInitial(leftName.first, rightName.first);
  const exactQueryAligned =
    nameVariantScore(left, query.professorName || '') >= 0.86 &&
    nameVariantScore(right, query.professorName || '') >= 0.86 &&
    crossVariantScore(left, right) >= 0.88;
  const institutionAligned = institutionsAligned(left, right, query.institutionName || '');
  const fieldAligned =
    !query.researchField || (fieldScore(left, query.researchField) >= 0.35 && fieldScore(right, query.researchField) >= 0.35);

  return sameLastName && sameInitial && institutionAligned && fieldAligned && (sharedExternalIdentity(left, right) || exactQueryAligned);
}

function mergeMatchEntries(left, right, query) {
  const merged = mergeAuthorProfiles([left, right], [], query.professorName || '');
  return {
    ...merged,
    matchScore: Math.max(left.matchScore || 0, right.matchScore || 0),
    mergedProfileCount: merged.mergedAuthorIds?.length || (left.mergedProfileCount || 1) + (right.mergedProfileCount || 1),
    profileType: 'merged',
  };
}

export function buildAuthorMatches(authors, query) {
  const ranked = rankAuthors(authors, query);
  const parent = ranked.map((_, index) => index);

  function find(index) {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  }

  function union(leftIndex, rightIndex) {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  }

  for (let leftIndex = 0; leftIndex < ranked.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ranked.length; rightIndex += 1) {
      if (shouldMerge(ranked[leftIndex], ranked[rightIndex], query)) {
        union(leftIndex, rightIndex);
      }
    }
  }

  const clusters = new Map();
  for (let index = 0; index < ranked.length; index += 1) {
    const root = find(index);
    const cluster = clusters.get(root) || [];
    cluster.push(ranked[index]);
    clusters.set(root, cluster);
  }

  const clusteredMatches = Array.from(clusters.values())
    .map((cluster) => {
      if (cluster.length === 1) {
        return {
          ...cluster[0],
          profileType: 'single',
          mergedProfileCount: 1,
        };
      }

      const merged = mergeAuthorProfiles(cluster, [], query.professorName || '');
      return {
        ...merged,
        matchScore: Math.max(...cluster.map((item) => item.matchScore || 0)),
        mergedProfileCount: cluster.length,
        profileType: 'merged',
      };
    })
    .sort((left, right) => right.matchScore - left.matchScore || (right.cited_by_count || 0) - (left.cited_by_count || 0));

  const dedupedMatches = [];
  for (const match of clusteredMatches) {
    const duplicateIndex = dedupedMatches.findIndex((existing) => shouldSuppressDuplicate(existing, match, query));
    if (duplicateIndex >= 0) {
      dedupedMatches[duplicateIndex] = mergeMatchEntries(dedupedMatches[duplicateIndex], match, query);
      continue;
    }
    dedupedMatches.push(match);
  }

  return dedupedMatches.sort(
    (left, right) => right.matchScore - left.matchScore || (right.cited_by_count || 0) - (left.cited_by_count || 0),
  );
}
