const USER_AGENT = 'Professor Research Opportunity Evaluator/0.1';
const MAX_SEED_PAGES = 3;
const MAX_FOLLOWUP_PAGES = 4;

const KEYWORD_PATTERNS = {
  undergraduate: /\b(undergrad|undergraduate|undergraduates|b\.s\.|bs student|summer research|reu)\b/gi,
  masters: /\b(master'?s|masters|m\.s\.|ms student|msc student|thesis)\b/gi,
  phd: /\b(ph\.?d\.?|doctoral|doctorate|prospective students|phd student|ph\.?d students)\b/gi,
  students: /\b(student|students|advisee|advisees|mentee|mentees)\b/gi,
  postdocs: /\b(postdoc|postdoctoral|post-doctoral)\b/gi,
  join: /\b(join|apply|opening|openings|opportunity|opportunities|recruiting|prospective students|research with me)\b/gi,
  publications: /\b(publication|publications|papers|preprints|selected papers|research output)\b/gi,
  people: /\b(people|members|team|group|lab|laboratory|research group)\b/gi,
  news: /\b(news|updates|latest|announcements|events)\b/gi,
};

const FOLLOWUP_HINTS = [
  'lab',
  'group',
  'team',
  'people',
  'member',
  'student',
  'publication',
  'paper',
  'research',
  'join',
  'opportunit',
  'openings',
  'prospective',
];

const BLOCKED_PROFILE_HOSTS = new Set([
  'dblp.org',
  'dl.acm.org',
  'github.com',
  'google.com',
  'linkedin.com',
  'mathgenealogy.org',
  'orcid.org',
  'openreview.net',
  'researchgate.net',
  'scholar.google.com',
  'semanticscholar.org',
  'twitter.com',
  'wikidata.org',
  'wikipedia.org',
  'www.github.com',
  'www.linkedin.com',
  'www.mathgenealogy.org',
  'www.orcid.org',
  'www.openreview.net',
  'www.researchgate.net',
  'www.semanticscholar.org',
  'www.twitter.com',
  'www.wikidata.org',
]);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreToPercent(score) {
  return Math.round(clamp(score, 0, 1) * 100);
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeNameToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function exactishMatch(left, right) {
  const a = normalizeNameToken(left);
  const b = normalizeNameToken(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.82;
  }
  const leftTokens = new Set(a.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(b.split(/\s+/).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function cleanDblpAuthorName(value) {
  return String(value || '').replace(/\s+\d{4}$/g, '').trim();
}

function primaryInstitutionCandidates(author, query) {
  const collected = [];
  const institutionHint = query?.institutionName || '';
  const pushInstitution = (institution, years = []) => {
    if (!institution?.display_name) {
      return;
    }
    collected.push({
      name: institution.display_name,
      ror: institution.ror || null,
      type: institution.type || null,
      years,
      matchScore: exactishMatch(institution.display_name, institutionHint),
    });
  };

  for (const item of author.last_known_institutions || []) {
    pushInstitution(item);
  }
  for (const item of author.affiliations || []) {
    pushInstitution(item.institution, item.years || []);
  }

  return collected
    .sort((left, right) => {
      const leftCurrent = left.years.includes(new Date().getFullYear()) ? 1 : 0;
      const rightCurrent = right.years.includes(new Date().getFullYear()) ? 1 : 0;
      return (
        right.matchScore - left.matchScore ||
        rightCurrent - leftCurrent ||
        Number(right.type === 'education') - Number(left.type === 'education')
      );
    })
    .filter((item, index, array) => array.findIndex((candidate) => candidate.name === item.name) === index)
    .slice(0, 3);
}

function hostBase(hostname) {
  const parts = String(hostname || '').split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }
  const secondLevel = parts.at(-2);
  if (parts.at(-1)?.length === 2 && ['ac', 'co', 'edu', 'gov', 'org'].includes(secondLevel)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function urlHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}

function sameInstitutionDomain(url, institutionDomains = []) {
  const host = urlHost(url);
  return institutionDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function sameAcademicDomain(left, right) {
  const leftHost = urlHost(left);
  const rightHost = urlHost(right);
  if (!leftHost || !rightHost) {
    return false;
  }
  return leftHost === rightHost || leftHost.endsWith(`.${rightHost}`) || rightHost.endsWith(`.${leftHost}`) || hostBase(leftHost) === hostBase(rightHost);
}

function sourceTier(url, institutionDomains = []) {
  if (sameInstitutionDomain(url, institutionDomains)) {
    return 'verified';
  }

  if (isLikelyOfficialUrl(url, institutionDomains)) {
    return 'supporting';
  }

  return 'untrusted';
}

function isLikelyOfficialUrl(url, institutionDomains = []) {
  const host = urlHost(url);
  if (!host || BLOCKED_PROFILE_HOSTS.has(host)) {
    return false;
  }

  if (sameInstitutionDomain(url, institutionDomains)) {
    return true;
  }

  if (host.endsWith('.edu')) {
    return true;
  }

  return host.endsWith('.ac.uk') || host.endsWith('.edu.cn') || host.endsWith('.org');
}

function classifyUrl(url, text = '') {
  const source = `${url} ${text}`.toLowerCase();
  if (source.includes('publication') || source.includes('papers') || source.includes('selected papers')) {
    return 'publications';
  }
  if (source.includes('student') || source.includes('people') || source.includes('member') || source.includes('team')) {
    return 'people';
  }
  if (source.includes('join') || source.includes('opportunit') || source.includes('prospective') || source.includes('opening')) {
    return 'opportunities';
  }
  if (source.includes('lab') || source.includes('group') || source.includes('center') || source.includes('centre')) {
    return 'lab';
  }
  return 'personal';
}

async function fetchText(url, headers = {}, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      'User-Agent': USER_AGENT,
      ...headers,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  return response.text();
}

function parseHtmlLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = normalizeUrl(match[1] || match[2] || match[3] || '');
    if (!href || href.startsWith('mailto:')) {
      continue;
    }
    let absolute = href;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const label = normalizeWhitespace((match[4] || '').replace(/<[^>]+>/g, ' '));
    links.push({
      url: absolute,
      text: label,
      kind: classifyUrl(absolute, label),
    });
  }
  return links;
}

export function extractMarkdownLinks(markdown, baseUrl = '') {
  const links = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  for (const match of markdown.matchAll(pattern)) {
    links.push({
      url: normalizeUrl(match[2]) || match[2],
      text: normalizeWhitespace(match[1]),
      kind: classifyUrl(match[2], match[1]),
    });
  }

  const barePattern = /\bhttps?:\/\/[^\s)<>"']+/gi;
  for (const match of markdown.matchAll(barePattern)) {
    const url = normalizeUrl(match[0]);
    if (!url) {
      continue;
    }
    if (!links.some((item) => item.url === url)) {
      links.push({
        url,
        text: '',
        kind: classifyUrl(url, ''),
      });
    }
  }

  if (baseUrl) {
    return links
      .map((item) => {
        try {
          return { ...item, url: new URL(item.url, baseUrl).toString() };
        } catch {
          return item;
        }
      })
      .filter((item) => item.url);
  }

  return links.filter((item) => item.url);
}

function extractYearSignals(text) {
  const years = Array.from(text.matchAll(/\b(20\d{2})\b/g)).map((match) => Number(match[1]));
  const thisYear = new Date().getFullYear();
  const recentYears = unique(years.filter((year) => year >= thisYear - 2 && year <= thisYear + 1));
  const latestYear = years.length ? Math.max(...years) : null;
  return {
    recentYears,
    latestYear,
  };
}

function buildSnippets(text, terms, limit = 4) {
  const snippets = [];
  const compact = normalizeWhitespace(text);
  for (const term of terms) {
    const pattern = new RegExp(`.{0,90}${escapeRegex(term)}.{0,120}`, 'i');
    const match = compact.match(pattern);
    if (match?.[0]) {
      const snippet = match[0].trim();
      if (!snippets.includes(snippet)) {
        snippets.push(snippet);
      }
    }
    if (snippets.length >= limit) {
      break;
    }
  }
  return snippets;
}

function firstSnippet(page, fallback = 'Verified page found, but no concise snippet was extracted.') {
  return page?.analysis?.snippets?.[0] || page?.snippets?.[0] || fallback;
}

function classifyPage(page, authorName = '') {
  const source = `${page.url} ${page.title} ${page.markdown.slice(0, 800)}`.toLowerCase();
  const path = (() => {
    try {
      return new URL(page.url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const titleMatch = exactishMatch(page.title, authorName);
  if (titleMatch >= 0.72 && !path.includes('publication') && !path.includes('paper')) {
    return 'personal';
  }
  if (source.includes('publication') || source.includes('papers') || source.includes('selected papers')) {
    return 'publications';
  }
  if (source.includes('student') || source.includes('people') || source.includes('member') || source.includes('team')) {
    return 'people';
  }
  if (source.includes('join') || source.includes('opportunit') || source.includes('prospective') || source.includes('opening')) {
    return 'opportunities';
  }
  if (source.includes('lab') || source.includes('group') || source.includes('center') || source.includes('centre')) {
    return 'lab';
  }
  return 'personal';
}

function analyzePageContent(page, author) {
  const markdown = normalizeWhitespace(page.markdown);
  const lower = markdown.toLowerCase();
  const years = extractYearSignals(markdown);
  const counts = Object.fromEntries(
    Object.entries(KEYWORD_PATTERNS).map(([key, pattern]) => [key, countMatches(lower, pattern)]),
  );
  const authorTokens = unique(normalizeNameToken(author.display_name).split(/\s+/));
  const nameMatches = authorTokens.filter((token) => token.length > 2 && lower.includes(token)).length;
  const snippets = buildSnippets(markdown, [
    'undergraduate',
    'undergraduates',
    "master's",
    'phd',
    'students',
    'postdoc',
    'join',
    'opportunities',
    'research with me',
    'publications',
  ]);

  return {
    kind: classifyPage({ ...page, markdown }, author.display_name),
    counts,
    recentYears: years.recentYears,
    latestYear: years.latestYear,
    nameMatches,
    snippets,
  };
}

function parseJinaDocument(text, url) {
  const normalized = normalizeWhitespace(text);
  const titleMatch = normalized.match(/^Title:\s*(.+)$/m);
  const publishedMatch = normalized.match(/^Published Time:\s*(.+)$/m);
  const marker = 'Markdown Content:';
  const contentIndex = normalized.indexOf(marker);
  const markdown = contentIndex >= 0 ? normalized.slice(contentIndex + marker.length).trim() : normalized;
  return {
    url,
    title: titleMatch?.[1]?.trim() || new URL(url).hostname,
    publishedTime: publishedMatch?.[1]?.trim() || null,
    markdown,
  };
}

async function fetchReadablePage(url) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  let html = '';
  let htmlLinks = [];
  try {
    html = await fetchText(normalizedUrl);
    htmlLinks = parseHtmlLinks(html, normalizedUrl);
  } catch {
    html = '';
  }

  let readable = null;
  try {
    const jinaUrl = `https://r.jina.ai/http://${normalizedUrl.replace(/^https?:\/\//, '')}`;
    const jinaText = await fetchText(jinaUrl, {}, 'text/plain, text/markdown;q=0.9, */*;q=0.8');
    readable = parseJinaDocument(jinaText, normalizedUrl);
  } catch {
    if (!html) {
      return null;
    }
  }

  const fallbackTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ').trim();
  const fallbackMarkdown = normalizeWhitespace(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const page = {
    url: normalizedUrl,
    title: readable?.title || fallbackTitle || new URL(normalizedUrl).hostname,
    publishedTime: readable?.publishedTime || null,
    markdown: readable?.markdown || fallbackMarkdown,
    links: unique([
      ...htmlLinks.map((item) => JSON.stringify(item)),
      ...extractMarkdownLinks(readable?.markdown || fallbackMarkdown, normalizedUrl).map((item) => JSON.stringify(item)),
    ]).map((item) => JSON.parse(item)),
  };

  return page.markdown ? page : null;
}

function scoreHit(hit, author, query) {
  const info = hit.info || {};
  const notes = Array.isArray(info.notes?.note) ? info.notes.note : info.notes?.note ? [info.notes.note] : [];
  const affiliation = notes.find((item) => item['@type'] === 'affiliation')?.text || '';
  const nameScore = exactishMatch(cleanDblpAuthorName(info.author), query.professorName || author.display_name);
  const institutionScore = exactishMatch(affiliation, query.institutionName || '');
  return nameScore * 0.72 + institutionScore * 0.28;
}

export function parseDblpExternalUrls(xmlText) {
  return unique(
    Array.from(String(xmlText || '').matchAll(/<url>(https?:\/\/[^<]+)<\/url>/gi))
      .map((match) => normalizeUrl(match[1]))
      .filter(Boolean),
  );
}

async function discoverDblpSources(author, query, institutionDomains = []) {
  const url = `https://dblp.org/search/author/api?q=${encodeURIComponent(query.professorName || author.display_name)}&format=json`;
  const data = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`DBLP search failed: ${response.status}`);
    }
    return response.json();
  });

  const hits = Array.isArray(data.result?.hits?.hit) ? data.result.hits.hit : data.result?.hits?.hit ? [data.result.hits.hit] : [];
  const bestHit = hits
    .map((hit) => ({ hit, score: scoreHit(hit, author, query) }))
    .sort((left, right) => right.score - left.score)[0];

  if (!bestHit || bestHit.score < 0.58) {
    return [];
  }

  const pidUrl = bestHit.hit.info?.url;
  if (!pidUrl) {
    return [];
  }

  const xmlText = await fetchText(`${pidUrl}.xml`, { Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' });
  return parseDblpExternalUrls(xmlText)
    .filter((candidateUrl) => isLikelyOfficialUrl(candidateUrl, institutionDomains))
    .map((candidateUrl) => ({
      url: candidateUrl,
      kind: 'dblp-homepage',
      label: 'Official page via DBLP',
      source: 'DBLP',
      confidence: 0.94,
      tier: sourceTier(candidateUrl, institutionDomains),
    }));
}

async function discoverOrcidSources(author, institutionDomains = []) {
  const orcidUrl = author.ids?.orcid || author.orcid;
  if (!orcidUrl) {
    return [];
  }

  const path = orcidUrl.split('/').pop();
  if (!path) {
    return [];
  }

  const data = await fetch(`https://pub.orcid.org/v3.0/${path}/person`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`ORCID request failed: ${response.status}`);
    }
    return response.json();
  });

  const items = data['researcher-urls']?.['researcher-url'] || [];
  const urlItems = Array.isArray(items) ? items : [items];
  return urlItems
    .map((item) => item?.url?.value)
    .map((value) => normalizeUrl(value))
    .filter((value) => value && isLikelyOfficialUrl(value, institutionDomains))
    .map((value) => ({
      url: value,
      kind: 'orcid-url',
      label: 'Researcher URL via ORCID',
      source: 'ORCID',
      confidence: 0.9,
      tier: sourceTier(value, institutionDomains),
    }));
}

async function fetchRorContext(rorUrl) {
  const rorId = String(rorUrl || '').split('/').pop();
  if (!rorId) {
    return null;
  }

  const data = await fetch(`https://api.ror.org/organizations/${rorId}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`ROR request failed: ${response.status}`);
    }
    return response.json();
  });

  const domains = (data.domains || []).map((domain) => String(domain).toLowerCase()).filter(Boolean);
  const links = (data.links || []).map((item) => normalizeUrl(item.value)).filter(Boolean);
  return {
    name: data.names?.[0]?.value || data.name || null,
    domains,
    links,
  };
}

async function discoverInstitutionContext(author, query) {
  const institutions = primaryInstitutionCandidates(author, query);
  const contexts = [];
  for (const institution of institutions) {
    if (!institution.ror) {
      continue;
    }
    try {
      const context = await fetchRorContext(institution.ror);
      if (context) {
        contexts.push(context);
      }
    } catch {
      continue;
    }
  }

  return {
    institutionDomains: unique(contexts.flatMap((item) => item.domains)),
    institutionLinks: unique(contexts.flatMap((item) => item.links)),
  };
}

async function discoverBingSources(author, query, institutionDomains) {
  if (!institutionDomains.length) {
    return [];
  }

  const domain = institutionDomains[0];
  const searchQuery = `"${query.professorName || author.display_name}" site:${domain}`;
  const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(searchQuery)}`;
  const xml = await fetchText(rssUrl, { Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' });
  const candidates = Array.from(xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>(https?:\/\/[\s\S]*?)<\/link>[\s\S]*?<\/item>/gi)).map((match) => ({
    title: normalizeWhitespace(match[1]),
    url: normalizeUrl(match[2]),
  }));

  return candidates
    .filter((item) => item.url && sameInstitutionDomain(item.url, institutionDomains))
    .slice(0, 3)
    .map((item) => ({
      url: item.url,
      kind: 'search-discovery',
      label: item.title || 'Institution profile',
      source: 'Bing RSS',
      confidence: 0.58,
      tier: 'verified',
    }));
}

function mergeCandidates(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of list) {
      const url = normalizeUrl(item.url);
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      merged.push({ ...item, url });
    }
  }
  return merged;
}

function pickFollowupLinks(seedPages, institutionDomains) {
  const candidates = [];
  for (const page of seedPages) {
    for (const link of page.links || []) {
      const lower = `${link.url} ${link.text}`.toLowerCase();
      const followsHint = FOLLOWUP_HINTS.some((hint) => lower.includes(hint));
      if (!followsHint) {
        continue;
      }
      if (!sameAcademicDomain(link.url, page.url) && !sameInstitutionDomain(link.url, institutionDomains)) {
        continue;
      }
      candidates.push({
        url: link.url,
        kind: link.kind || classifyUrl(link.url, link.text),
        label: link.text || 'Related page',
        source: 'Official page link',
        confidence: 0.76,
        tier: sourceTier(link.url, institutionDomains),
      });
    }
  }

  return mergeCandidates(candidates).slice(0, MAX_FOLLOWUP_PAGES);
}

function aggregateSignals(seedSources, pages, institutionDomains) {
  const verifiedSources = seedSources.filter((item) => item.tier === 'verified');
  const supportingSources = seedSources.filter((item) => item.tier !== 'verified');
  const verifiedPages = pages.filter(
    (page) => page.discoveredFrom?.tier === 'verified' || sameInstitutionDomain(page.url, institutionDomains),
  );
  const supportingPages = pages.filter((page) => !verifiedPages.some((verifiedPage) => verifiedPage.url === page.url));
  const scoringPages = verifiedPages;
  const presence = {
    personal: 0,
    lab: 0,
    people: 0,
    publications: 0,
    opportunities: 0,
  };
  const counts = {
    undergraduate: 0,
    masters: 0,
    phd: 0,
    students: 0,
    postdocs: 0,
    join: 0,
    publications: 0,
    people: 0,
    news: 0,
  };
  const recentYears = new Set();
  const evidencePages = scoringPages.map((page) => {
    presence[page.analysis.kind] = 1;
    for (const [key, value] of Object.entries(page.analysis.counts)) {
      counts[key] += value;
    }
    for (const year of page.analysis.recentYears) {
      recentYears.add(year);
    }
    return {
      url: page.url,
      title: page.title,
      kind: page.analysis.kind,
      publishedTime: page.publishedTime,
      snippets: page.analysis.snippets.slice(0, 3),
      signalSummary: `${page.analysis.kind} page · verified institution-domain evidence`,
    };
  });

  const coverageCategories = Object.values(presence).reduce((sum, value) => sum + value, 0);
  const evidenceCoverage = scoreToPercent(
    clamp(coverageCategories / 5) * 0.42 +
      clamp(evidencePages.length / 4) * 0.28 +
      clamp(verifiedSources.length / 3) * 0.14 +
      clamp(evidencePages.filter((page) => page.kind === 'publications').length / 2) * 0.08 +
      clamp(recentYears.size / 3) * 0.08,
  );
  const evidenceConfidence = scoreToPercent(
    clamp(verifiedSources.length / 2) * 0.42 +
    clamp(evidencePages.length / 4) * 0.3 +
    clamp(evidencePages.filter((page) => page.snippets.length).length / 3) * 0.16 +
    clamp(coverageCategories / 5) * 0.12,
  );

  const verifiedFacts = [];
  if (verifiedSources.length) {
    verifiedFacts.push({
      label: 'Verified institutional source',
      value: `${verifiedSources.length} source${verifiedSources.length === 1 ? '' : 's'} found`,
      sourceUrl: verifiedSources[0].url,
      sourceLabel: verifiedSources[0].label,
      detail: 'At least one professor or lab page lives on an institution-controlled domain.',
    });
  }
  if (presence.people) {
    const peoplePage = verifiedPages.find((page) => page.analysis.kind === 'people');
    verifiedFacts.push({
      label: 'Verified team or people page',
      value: 'Present',
      sourceUrl: peoplePage?.url || verifiedSources[0]?.url || '',
      sourceLabel: peoplePage?.title || verifiedSources[0]?.label || 'Verified source',
      detail: firstSnippet(peoplePage, 'The verified page exposes current team or people structure.'),
    });
  }
  if (counts.join > 0) {
    const opportunityPage = verifiedPages.find((page) => page.analysis.counts.join > 0);
    verifiedFacts.push({
      label: 'Verified opportunity language',
      value: 'Present',
      sourceUrl: opportunityPage?.url || verifiedSources[0]?.url || '',
      sourceLabel: opportunityPage?.title || verifiedSources[0]?.label || 'Verified source',
      detail: firstSnippet(opportunityPage),
    });
  }
  if (presence.publications) {
    const publicationPage = verifiedPages.find((page) => page.analysis.kind === 'publications');
    verifiedFacts.push({
      label: 'Verified publications page',
      value: 'Present',
      sourceUrl: publicationPage?.url || verifiedSources[0]?.url || '',
      sourceLabel: publicationPage?.title || verifiedSources[0]?.label || 'Verified source',
      detail: firstSnippet(publicationPage, 'The verified site links to publications or selected papers.'),
    });
  }
  if (recentYears.size) {
    const freshPage = verifiedPages.find((page) => page.analysis.recentYears.length > 0);
    verifiedFacts.push({
      label: 'Recent update markers on verified pages',
      value: Array.from(recentYears).sort().join(', '),
      sourceUrl: freshPage?.url || verifiedSources[0]?.url || '',
      sourceLabel: freshPage?.title || verifiedSources[0]?.label || 'Verified source',
      detail: firstSnippet(freshPage, 'Recent year markers were extracted from verified institutional pages.'),
    });
  }

  const highlights = [];
  if (presence.personal) {
    highlights.push('A verified professor homepage was found on an institution-controlled domain.');
  }
  if (presence.lab) {
    highlights.push('A verified lab or group page was found on an institution-controlled domain.');
  }
  if (counts.join > 0) {
    highlights.push('Verified pages contain explicit join, apply, or research-opportunity language.');
  }
  if (presence.publications) {
    highlights.push('A verified publications page was found on an institution-controlled domain.');
  }
  if (recentYears.size) {
    highlights.push(`Verified institutional pages contain recent year markers: ${Array.from(recentYears).sort().join(', ')}.`);
  }

  const caveats = [];
  if (!verifiedSources.length) {
    caveats.push('No verified institution-domain professor or lab page was found automatically, so website evidence is absent from this report.');
  }
  if (supportingPages.length) {
    caveats.push('Supporting external pages were found, but they stay outside the verified source boundary.');
  }
  if (verifiedPages.length && !recentYears.size) {
    caveats.push('Verified pages were found, but they do not expose obvious recent-year markers in the fetched sample.');
  }

  const inferenceBoundaries = [
    'Publication influence, quality, and output come from OpenAlex metadata rather than professor websites.',
    'Institutional webpages are retained only as a verified source boundary, not as a primary opportunity-scoring signal.',
    'Supporting external pages can still be shown, but they do not drive objective research metrics.',
    'Collaborator student status is labeled only when an external record exposes explicit career-stage metadata.',
  ];

  return {
    metrics: {
      evidenceCoverage,
      verificationConfidence: evidenceConfidence,
    },
    boundaryStats: {
      verifiedSourceCount: verifiedSources.length,
      verifiedPageCount: evidencePages.length,
      verifiedSnippetCount: evidencePages.reduce((sum, page) => sum + page.snippets.length, 0),
      recentYearMarkerCount: recentYears.size,
      pageDiversity: coverageCategories,
    },
    confidence: evidenceConfidence,
    institutionDomains,
    officialSources: verifiedSources.map((item) => ({
      label: item.label,
      kind: item.kind,
      url: item.url,
      source: item.source,
    })),
    verifiedSources: verifiedSources.map((item) => ({
      label: item.label,
      kind: item.kind,
      url: item.url,
      source: item.source,
    })),
    supportingSources: supportingSources.map((item) => ({
      label: item.label,
      kind: item.kind,
      url: item.url,
      source: item.source,
    })),
    pages: evidencePages,
    verifiedPages: evidencePages,
    supportingPages: supportingPages.map((page) => ({
      url: page.url,
      title: page.title,
      kind: page.analysis.kind,
      publishedTime: page.publishedTime,
      snippets: page.analysis.snippets.slice(0, 2),
      signalSummary: `${page.analysis.kind} page · supporting only`,
    })),
    verifiedFacts: verifiedFacts.slice(0, 6),
    highlights: highlights.slice(0, 4),
    caveats: caveats.slice(0, 4),
    inferenceBoundaries,
  };
}

export async function enrichProfessorWebPresence({ author, query }) {
  try {
    const institutionContext = await discoverInstitutionContext(author, query);
    const dblpSources = await discoverDblpSources(author, query, institutionContext.institutionDomains).catch(() => []);
    const orcidSources = await discoverOrcidSources(author, institutionContext.institutionDomains).catch(() => []);
    const bingSources =
      dblpSources.length || orcidSources.length
        ? []
        : await discoverBingSources(author, query, institutionContext.institutionDomains).catch(() => []);
    const seedSources = mergeCandidates(dblpSources, orcidSources, bingSources).slice(0, MAX_SEED_PAGES);
    const seedPages = (
      await Promise.all(
        seedSources.map(async (source) => {
          const page = await fetchReadablePage(source.url);
          if (!page) {
            return null;
          }
          return {
            ...page,
            discoveredFrom: source,
            analysis: analyzePageContent(page, author),
          };
        }),
      )
    ).filter(Boolean);

    const followupSources = pickFollowupLinks(seedPages, institutionContext.institutionDomains);
    const followupPages = (
      await Promise.all(
        followupSources.map(async (source) => {
          const page = await fetchReadablePage(source.url);
          if (!page) {
            return null;
          }
          return {
            ...page,
            discoveredFrom: source,
            analysis: analyzePageContent(page, author),
          };
        }),
      )
    ).filter(Boolean);

    const pages = mergeCandidates(
      seedPages.map((page) => ({ url: page.url, page })),
      followupPages.map((page) => ({ url: page.url, page })),
    ).map((item) => item.page);

    return aggregateSignals(seedSources, pages, institutionContext.institutionDomains);
  } catch {
    return {
      metrics: {
        evidenceCoverage: 0,
        verificationConfidence: 0,
      },
      boundaryStats: {
        verifiedSourceCount: 0,
        verifiedPageCount: 0,
        verifiedSnippetCount: 0,
        recentYearMarkerCount: 0,
        pageDiversity: 0,
      },
      confidence: 0,
      institutionDomains: [],
      officialSources: [],
      verifiedSources: [],
      supportingSources: [],
      pages: [],
      verifiedPages: [],
      supportingPages: [],
      verifiedFacts: [],
      highlights: [],
      caveats: ['Website enrichment failed for this profile, so the report falls back to publication metadata only.'],
      inferenceBoundaries: [
        'Website enrichment failed, so only publication metadata contributes to the current report.',
      ],
    };
  }
}
