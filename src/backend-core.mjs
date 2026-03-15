import { evaluateProfessor, pickInstitution } from './prof-evaluator.mjs';
import { buildAuthorMatches, dedupeWorks, mergeAuthorProfiles } from './author-merge.mjs';
import { buildCollaborationInsights } from './collaboration-insights.mjs';
import { lookupInspireIdentityEvidence } from './inspire-evidence.mjs';
import { enrichProfessorWebPresence } from './web-enrichment.mjs';
import { lookupSemanticScholar } from './semantic-scholar.mjs';
import { buildScholarAuthorSearchUrl, buildScholarPaperSearchUrl, lookupGoogleScholar } from './google-scholar.mjs';
import { enrichTopWorksWithCrossref } from './crossref-enrichment.mjs';

const reportCache = new Map();
const openAlexJsonCache = new Map();

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeQuery(body = {}) {
  return {
    professorName: String(body.professorName || '').trim(),
    researchField: String(body.researchField || '').trim(),
    institutionName: String(body.institutionName || '').trim(),
    audienceLevel: String(body.audienceLevel || 'all').trim() || 'all',
    apiEmail: String(body.apiEmail || '').trim(),
    apiKey: String(body.apiKey || '').trim(),
  };
}

export function normalizeAuthorIds(body = {}) {
  const authorIds = Array.isArray(body.authorIds)
    ? body.authorIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (authorIds.length) {
    return authorIds;
  }

  const authorId = String(body.authorId || '').trim();
  return authorId ? [authorId] : [];
}

function appendApiSettings(url, query) {
  const nextUrl = new URL(url);
  if (query.apiEmail) {
    nextUrl.searchParams.set('mailto', query.apiEmail);
  }
  if (query.apiKey) {
    nextUrl.searchParams.set('api_key', query.apiKey);
  }
  return nextUrl.toString();
}

async function fetchJson(url, query) {
  const requestUrl = appendApiSettings(url, query);
  if (openAlexJsonCache.has(requestUrl)) {
    return openAlexJsonCache.get(requestUrl);
  }

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Professor Research Opportunity Evaluator/0.1',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  openAlexJsonCache.set(requestUrl, payload);
  return payload;
}

async function fetchAuthorDetails(authorId, query) {
  const authorKey = String(authorId).split('/').pop();
  const url = new URL(`https://api.openalex.org/authors/${authorKey}`);
  return fetchJson(url, query);
}

async function fetchWorks(author, query) {
  const works = [];
  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    const url = new URL(author.works_api_url || 'https://api.openalex.org/works');
    url.searchParams.set('sort', 'publication_date:desc');
    url.searchParams.set('per-page', '50');
    url.searchParams.set('page', String(pageNumber));
    const data = await fetchJson(url, query);
    works.push(...(data.results || []));
    if (!data.results || data.results.length < 50) {
      break;
    }
  }
  return works;
}

function reportCacheKey(authorId, query) {
  return JSON.stringify({
    authorIds: Array.isArray(authorId) ? authorId.map((value) => String(value).split('/').pop()).sort() : [String(authorId).split('/').pop()],
    researchField: query.researchField,
    institutionName: query.institutionName,
    audienceLevel: query.audienceLevel,
  });
}

function withIdentityMetadata(author) {
  return {
    ...author,
    mergedAuthorIds: author.mergedAuthorIds || [author.id],
    mergedProfileCount: author.mergedProfileCount || 1,
    profileType: author.profileType || ((author.mergedProfileCount || 1) > 1 ? 'merged' : 'single'),
  };
}

async function hydrateAuthorSelection(authorIds, query) {
  const profiles = await Promise.all(authorIds.map((authorId) => fetchAuthorDetails(authorId, query)));
  if (profiles.length === 1) {
    const author = withIdentityMetadata(profiles[0]);
    const works = await fetchWorks(author, query);
    return { author, works };
  }

  const works = dedupeWorks((await Promise.all(profiles.map((author) => fetchWorks(author, query)))).flat());
  const author = withIdentityMetadata(mergeAuthorProfiles(profiles, works, query.professorName || ''));
  return { author, works };
}

function normalizeOrcidUrl(orcid) {
  if (!orcid) return null;
  const bare = String(orcid).replace(/^https?:\/\/orcid\.org\//i, '').trim();
  if (!bare) return null;
  return `https://orcid.org/${bare}`;
}

function buildExternalProfiles(author, query, { inspire, semanticScholar, googleScholar, dblpProfileUrl = null }) {
  const profiles = {
    inspire: inspire || null,
    semanticScholar: semanticScholar || null,
    googleScholar: googleScholar || {
      source: 'Google Scholar',
      provider: 'direct',
      status: 'unavailable',
      searchUrl: buildScholarPaperSearchUrl(author.display_name, pickInstitution(author, query.institutionName || '')),
      authorSearchUrl: buildScholarAuthorSearchUrl(author.display_name),
      note: 'Structured Scholar data was not recovered for this profile.',
    },
    orcidUrl: normalizeOrcidUrl(author.ids?.orcid),
    openalex: author.id || null,
    homepage: author.homepage_url || semanticScholar?.homepage || null,
    dblpProfileUrl: dblpProfileUrl || null,
  };

  const openAlexIds = author.ids || {};
  if (openAlexIds.scopus) {
    profiles.scopusUrl = `https://www.scopus.com/authid/detail.uri?authorId=${String(openAlexIds.scopus).split('/').pop()}`;
  }

  return profiles;
}

export async function searchAuthors(payload) {
  const query = normalizeQuery(payload);
  if (!query.professorName) {
    throw new Error('Professor name is required.');
  }

  const url = new URL('https://api.openalex.org/authors');
  url.searchParams.set('search', query.professorName);
  url.searchParams.set('per-page', '12');

  const data = await fetchJson(url, query);
  const matches = buildAuthorMatches(data.results || [], query).map((author) => ({
    ...author,
    matchScore: clamp(Number(author.matchScore || 0), 0, 100),
  }));

  return { matches };
}

export async function buildProfessorReport(payload = {}) {
  const query = normalizeQuery(payload.query);
  const authorIds = normalizeAuthorIds(payload);

  if (!authorIds.length) {
    throw new Error('Author ID is required.');
  }

  const cacheKey = reportCacheKey(authorIds, query);
  if (reportCache.has(cacheKey)) {
    return { report: reportCache.get(cacheKey) };
  }

  const { author, works } = await hydrateAuthorSelection(authorIds, query);
  const websiteSignals = await enrichProfessorWebPresence({ author, query, works });
  const inspireProfile = await lookupInspireIdentityEvidence({
    name: author.display_name,
    institution: pickInstitution(author, query.institutionName || ''),
    orcid: author.ids?.orcid || '',
  }).catch(() => null);
  const [collaborationInsights, semanticScholarProfile, googleScholarProfile] = await Promise.all([
    buildCollaborationInsights({
      author,
      works,
      fetchAuthorById: (collaboratorId) => fetchAuthorDetails(collaboratorId, query),
      fetchIdentityEvidence: ({ name, institution, orcid }) => lookupInspireIdentityEvidence({ name, institution, orcid }),
    }),
    lookupSemanticScholar({
      name: author.display_name,
      orcid: author.ids?.orcid || '',
    }).catch(() => null),
    lookupGoogleScholar({
      name: author.display_name,
      institution: pickInstitution(author, query.institutionName || ''),
      researchField: query.researchField,
    }).catch(() => null),
  ]);

  const externalProfiles = buildExternalProfiles(author, query, {
    inspire: inspireProfile,
    semanticScholar: semanticScholarProfile,
    googleScholar: googleScholarProfile,
    dblpProfileUrl: websiteSignals?.dblpProfileUrl || null,
  });

  const report = evaluateProfessor({
    author,
    works,
    researchField: query.researchField,
    audience: query.audienceLevel,
    institutionHint: query.institutionName,
    websiteSignals,
    collaborationInsights,
    externalProfiles,
  });

  report.topWorks = await enrichTopWorksWithCrossref(report.topWorks).catch(() => report.topWorks);
  reportCache.set(cacheKey, report);
  return { report };
}
