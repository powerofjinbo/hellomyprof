const USER_AGENT = 'Professor Research Evidence Dashboard/0.3';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitName(value) {
  const tokens = normalizeText(value)
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return {
    first: tokens[0] || '',
    last: tokens.at(-1) || '',
  };
}

function textSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
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

function nameSimilarity(left, right) {
  const base = textSimilarity(left, right);
  const leftName = splitName(left);
  const rightName = splitName(right);

  if (!leftName.last || leftName.last !== rightName.last || !leftName.first || !rightName.first) {
    return base;
  }

  if (leftName.first === rightName.first) {
    return Math.max(base, 0.97);
  }

  if (leftName.first[0] === rightName.first[0] && (leftName.first.length === 1 || rightName.first.length === 1)) {
    return Math.max(base, 0.92);
  }

  return base;
}

function tokenize(value) {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/\s+/)
        .filter((token) => token && token.length > 2),
    ),
  );
}

function jaccard(left, right) {
  const leftTokens = new Set(left);
  const rightTokens = new Set(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/[^\d.]/g, '');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    for (const key of ['all', 'total', 'value', 'count', 'citations']) {
      const candidate = toNumber(value[key]);
      if (candidate != null) return candidate;
    }
  }
  return null;
}

function compactObjectValues(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap((entry) => {
    if (Array.isArray(entry)) return entry;
    if (entry && typeof entry === 'object') return compactObjectValues(entry);
    return [entry];
  });
}

function buildScholarPaperSearchUrl(name, institution = '') {
  const terms = [name, institution].filter(Boolean).join(' ');
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(terms)}`;
}

function buildScholarAuthorSearchUrl(name) {
  return `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(name)}`;
}

function buildScholarProfileUrl(authorId) {
  if (!authorId) return null;
  return `https://scholar.google.com/citations?user=${encodeURIComponent(authorId)}&hl=en`;
}

function normalizeInterestList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      return entry?.title || entry?.name || entry?.label || '';
    })
    .filter(Boolean);
}

function extractProfileName(profile) {
  return profile?.name || profile?.author?.name || '';
}

function extractProfileAffiliation(profile) {
  return profile?.affiliations || profile?.affiliation || profile?.author?.affiliations || '';
}

function extractProfileEmail(profile) {
  return profile?.email || profile?.author?.email || '';
}

function extractProfileInterests(profile) {
  return normalizeInterestList(profile?.interests || profile?.author?.interests);
}

function extractProfileUrl(profile) {
  return profile?.link || profile?.author?.link || null;
}

function extractProfileAuthorId(profile) {
  return profile?.author_id || profile?.author?.author_id || null;
}

function scoreScholarProfile(profile, { name, institution, researchField }) {
  const profileName = extractProfileName(profile);
  const profileAffiliation = extractProfileAffiliation(profile);
  const profileInterests = extractProfileInterests(profile);

  const nameScore = nameSimilarity(profileName, name);
  const institutionScore = institution ? textSimilarity(profileAffiliation, institution) : 0.55;
  const fieldScore = researchField
    ? jaccard(tokenize(profileInterests.join(' ')), tokenize(researchField))
    : 0.55;
  const emailScore = extractProfileEmail(profile).endsWith('.edu') ? 0.05 : 0;
  const total = nameScore * 0.68 + institutionScore * 0.2 + fieldScore * 0.12 + emailScore;

  return {
    total,
    nameScore,
    institutionScore,
    fieldScore,
  };
}

function selectBestScholarProfile(profiles, context) {
  const scored = profiles
    .map((profile) => ({
      profile,
      ...scoreScholarProfile(profile, context),
    }))
    .sort((left, right) => right.total - left.total);

  const best = scored[0];
  if (!best) return null;

  if (best.nameScore >= 0.88) return best;
  if (best.nameScore >= 0.74 && best.institutionScore >= 0.42) return best;
  return null;
}

function scholarTableRows(payload) {
  const directRows = Array.isArray(payload?.cited_by?.table?.rows)
    ? payload.cited_by.table.rows
    : Array.isArray(payload?.cited_by?.table)
      ? payload.cited_by.table
      : Array.isArray(payload?.cited_by)
        ? payload.cited_by
        : [];
  if (directRows.length) return directRows;
  return compactObjectValues(payload?.cited_by).filter((entry) => entry && typeof entry === 'object');
}

function lookupScholarMetric(payload, metricName) {
  const normalizedTarget = normalizeText(metricName);
  for (const row of scholarTableRows(payload)) {
    const label = normalizeText(row.metric || row.name || row.label || row.title || '');
    if (!label) continue;
    if (label.includes(normalizedTarget)) {
      for (const key of ['all', 'total', 'value', 'count']) {
        const candidate = toNumber(row[key]);
        if (candidate != null) return candidate;
      }
      for (const value of compactObjectValues(row)) {
        const candidate = toNumber(value);
        if (candidate != null) return candidate;
      }
    }
  }

  const containers = [
    payload?.cited_by?.table,
    payload?.cited_by,
    payload?.metrics,
  ].filter(Boolean);

  for (const container of containers) {
    if (!container || typeof container !== 'object') continue;
    for (const [key, value] of Object.entries(container)) {
      if (normalizeText(key).includes(normalizedTarget)) {
        const candidate = toNumber(value);
        if (candidate != null) return candidate;
      }
    }
  }

  return null;
}

function normalizeScholarCoAuthors(payload) {
  const raw = Array.isArray(payload?.co_authors) ? payload.co_authors : [];
  return raw
    .map((entry) => ({
      name: entry?.name || '',
      affiliation: entry?.affiliations || entry?.affiliation || '',
      link: entry?.link || buildScholarProfileUrl(entry?.author_id),
    }))
    .filter((entry) => entry.name)
    .slice(0, 8);
}

function normalizeScholarArticleSample(payload) {
  const raw = Array.isArray(payload?.articles) ? payload.articles : [];
  return raw
    .map((entry) => ({
      title: entry?.title || '',
      citations: toNumber(entry?.cited_by?.value ?? entry?.cited_by) ?? null,
      year: toNumber(entry?.year) ?? null,
      link: entry?.link || null,
    }))
    .filter((entry) => entry.title)
    .slice(0, 5);
}

async function fetchJson(url, fetchImpl, label) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(18_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label} request failed with status ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }

  return response.json();
}

async function lookupViaSearchApi({ name, institution, researchField, fetchImpl, apiKey }) {
  const searchUrl = new URL('https://www.searchapi.io/api/v1/search');
  searchUrl.searchParams.set('engine', 'google_scholar');
  searchUrl.searchParams.set('q', `author:${name}`);
  searchUrl.searchParams.set('api_key', apiKey);

  const searchPayload = await fetchJson(searchUrl, fetchImpl, 'SearchAPI Google Scholar');
  const profiles = Array.isArray(searchPayload?.profiles) ? searchPayload.profiles : [];
  const best = selectBestScholarProfile(profiles, { name, institution, researchField });

  if (!best) {
    return {
      source: 'Google Scholar',
      provider: 'SearchAPI',
      status: 'unavailable',
      searchUrl: buildScholarPaperSearchUrl(name, institution),
      authorSearchUrl: buildScholarAuthorSearchUrl(name),
      note: 'SearchAPI did not return a confidently matched Scholar profile for this author query.',
    };
  }

  const profile = best.profile;
  const authorId = extractProfileAuthorId(profile);
  const profileUrl = extractProfileUrl(profile) || buildScholarProfileUrl(authorId);

  if (!authorId) {
    return {
      source: 'Google Scholar',
      provider: 'SearchAPI',
      status: 'matched',
      searchUrl: buildScholarPaperSearchUrl(name, institution),
      authorSearchUrl: buildScholarAuthorSearchUrl(name),
      profileUrl,
      authorId: null,
      name: extractProfileName(profile),
      affiliation: extractProfileAffiliation(profile),
      verifiedEmail: extractProfileEmail(profile) || null,
      citationCount: toNumber(profile?.cited_by?.value ?? profile?.cited_by) ?? null,
      hIndex: null,
      i10Index: null,
      interests: extractProfileInterests(profile),
      coAuthors: [],
      articleSample: [],
      matchConfidence: Math.round(best.total * 100),
      note: 'Scholar profile search matched, but no author_id was exposed for a detailed profile lookup.',
    };
  }

  const detailUrl = new URL('https://www.searchapi.io/api/v1/search');
  detailUrl.searchParams.set('engine', 'google_scholar_author');
  detailUrl.searchParams.set('author_id', authorId);
  detailUrl.searchParams.set('api_key', apiKey);

  const detailPayload = await fetchJson(detailUrl, fetchImpl, 'SearchAPI Google Scholar author');
  return {
    source: 'Google Scholar',
    provider: 'SearchAPI',
    status: 'matched',
    searchUrl: buildScholarPaperSearchUrl(name, institution),
    authorSearchUrl: buildScholarAuthorSearchUrl(name),
    profileUrl,
    authorId,
    name: detailPayload?.author?.name || extractProfileName(profile),
    affiliation: detailPayload?.author?.affiliations || extractProfileAffiliation(profile),
    verifiedEmail: detailPayload?.author?.email || extractProfileEmail(profile) || null,
    citationCount:
      lookupScholarMetric(detailPayload, 'citations') ??
      toNumber(profile?.cited_by?.value ?? profile?.cited_by) ??
      null,
    hIndex: lookupScholarMetric(detailPayload, 'h index'),
    i10Index: lookupScholarMetric(detailPayload, 'i10 index'),
    interests: normalizeInterestList(detailPayload?.author?.interests).length
      ? normalizeInterestList(detailPayload?.author?.interests)
      : extractProfileInterests(profile),
    coAuthors: normalizeScholarCoAuthors(detailPayload),
    articleSample: normalizeScholarArticleSample(detailPayload),
    matchConfidence: Math.round(best.total * 100),
    note: 'Structured Scholar data recovered through SearchAPI.',
  };
}

async function probeDirectGoogleScholar({ name, institution, fetchImpl }) {
  const authorSearchUrl = buildScholarAuthorSearchUrl(name);
  const paperSearchUrl = buildScholarPaperSearchUrl(name, institution);

  try {
    const response = await fetchImpl(authorSearchUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': USER_AGENT,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    });

    const location = response.headers?.get?.('location') || '';
    if (response.status >= 300 && response.status < 400 && location.includes('accounts.google.com')) {
      return {
        source: 'Google Scholar',
        provider: 'direct',
        status: 'blocked',
        searchUrl: paperSearchUrl,
        authorSearchUrl,
        note: 'Direct Scholar author search was redirected into a Google login flow from this environment.',
      };
    }

    const text = await response.text().catch(() => '');
    if (response.status === 403 || /we're sorry|403\.|automated queries/i.test(text)) {
      return {
        source: 'Google Scholar',
        provider: 'direct',
        status: 'blocked',
        searchUrl: paperSearchUrl,
        authorSearchUrl,
        note: 'Google Scholar blocked automated requests from this environment.',
      };
    }

    return {
      source: 'Google Scholar',
      provider: 'direct',
      status: 'unavailable',
      searchUrl: paperSearchUrl,
      authorSearchUrl,
      note: 'Direct Scholar access responded, but no structured profile data could be extracted safely.',
    };
  } catch (error) {
    return {
      source: 'Google Scholar',
      provider: 'direct',
      status: 'error',
      searchUrl: paperSearchUrl,
      authorSearchUrl,
      note: error instanceof Error ? error.message : 'Direct Scholar lookup failed unexpectedly.',
    };
  }
}

export async function lookupGoogleScholar({
  name,
  institution = '',
  researchField = '',
  fetchImpl = fetch,
  env = process.env,
}) {
  if (!name) return null;

  const searchApiKey = env.SEARCHAPI_API_KEY || env.GOOGLE_SCHOLAR_SEARCHAPI_KEY || '';
  if (searchApiKey) {
    try {
      return await lookupViaSearchApi({
        name,
        institution,
        researchField,
        fetchImpl,
        apiKey: searchApiKey,
      });
    } catch (error) {
      return {
        source: 'Google Scholar',
        provider: 'SearchAPI',
        status: 'error',
        searchUrl: buildScholarPaperSearchUrl(name, institution),
        authorSearchUrl: buildScholarAuthorSearchUrl(name),
        note: error instanceof Error ? error.message : 'SearchAPI Google Scholar lookup failed unexpectedly.',
      };
    }
  }

  return probeDirectGoogleScholar({ name, institution, fetchImpl });
}

export { buildScholarAuthorSearchUrl, buildScholarPaperSearchUrl };
