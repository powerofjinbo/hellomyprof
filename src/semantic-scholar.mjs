const USER_AGENT = 'Professor Research Evidence Dashboard/0.2';

function normalizeNameToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameOverlap(left, right) {
  const a = new Set(normalizeNameToken(left).split(/\s+/).filter(Boolean));
  const b = new Set(normalizeNameToken(right).split(/\s+/).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

function selectBestMatch(results, { name, orcid }) {
  if (!results.length) return null;

  const orcidBare = String(orcid || '')
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .trim();

  const scored = results.map((author) => {
    const authorOrcids = (author.externalIds?.ORCID ? [author.externalIds.ORCID] : []);
    const orcidMatch = orcidBare && authorOrcids.includes(orcidBare) ? 1 : 0;
    const nScore = nameOverlap(author.name || '', name);
    return {
      author,
      total: orcidMatch * 0.7 + nScore * 0.3,
      orcidMatch,
      nScore,
    };
  }).sort((a, b) => b.total - a.total);

  const best = scored[0];
  if (!best) return null;
  if (best.orcidMatch) return best.author;
  if (best.nScore >= 0.85) return best.author;
  return null;
}

export async function lookupSemanticScholar({ name, orcid = '', fetchImpl = fetch }) {
  if (!name) return null;

  const url = new URL('https://api.semanticscholar.org/graph/v1/author/search');
  url.searchParams.set('query', name);
  url.searchParams.set('limit', '5');
  url.searchParams.set('fields', 'name,url,externalIds,hIndex,citationCount,paperCount,homepage');

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Semantic Scholar request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const results = payload?.data || [];
  const match = selectBestMatch(results, { name, orcid });

  if (!match) return null;

  return {
    authorId: match.authorId,
    name: match.name,
    url: match.url || `https://www.semanticscholar.org/author/${match.authorId}`,
    homepage: match.homepage || null,
    hIndex: match.hIndex ?? null,
    citationCount: match.citationCount ?? null,
    paperCount: match.paperCount ?? null,
    externalIds: match.externalIds || {},
    source: 'Semantic Scholar',
  };
}
