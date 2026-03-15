function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }

  if (!raw.includes(',')) {
    return raw;
  }

  const [last, rest] = raw.split(',').map((part) => part.trim());
  return [rest, last].filter(Boolean).join(' ').trim();
}

function splitName(value) {
  const tokens = normalizeName(value).split(/\s+/).filter(Boolean);
  return {
    tokens,
    first: tokens[0] || '',
    last: tokens.at(-1) || '',
  };
}

function overlapScore(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (!left.size || !right.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(left.size, right.size);
}

function nameScore(left, right) {
  const a = splitName(left);
  const b = splitName(right);
  if (!a.last || !b.last) {
    return 0;
  }

  if (a.last !== b.last) {
    return 0;
  }

  if (normalizeName(left) === normalizeName(right)) {
    return 1;
  }

  const initialMatch = a.first?.[0] && a.first[0] === b.first?.[0] ? 1 : 0;
  const overlap = overlapScore(a.tokens, b.tokens);
  return Math.min(1, initialMatch * 0.55 + overlap * 0.45);
}

function institutionScore(left, right) {
  const a = normalizeText(left).replace(/university/g, 'u').replace(/institute/g, 'inst');
  const b = normalizeText(right).replace(/university/g, 'u').replace(/institute/g, 'inst');
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.88;
  }
  return overlapScore(a.split(/\s+/), b.split(/\s+/));
}

function stripOrcid(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/\s+/g, '');
}

function recordOrcids(record) {
  return (record?.metadata?.ids || [])
    .filter((item) => String(item?.schema || '').toUpperCase() === 'ORCID')
    .map((item) => stripOrcid(item.value));
}

function summarizePositions(positions = []) {
  return positions
    .slice(0, 4)
    .map((position) => {
      const rank = String(position.rank || '').toUpperCase();
      const institution = position.institution || 'Institution unavailable';
      const current = position.current ? 'current' : 'historical';
      return `${rank} at ${institution} (${current})`;
    })
    .join('; ');
}

const STUDENT_RANKS = new Set(['UNDERGRADUATE', 'PHD', 'MASTER', 'MASTERS', 'STUDENT']);
const JUNIOR_RANKS = new Set(['JUNIOR', 'POSTDOC']);

function positionSortValue(position) {
  return Number(String(position.end_date || position.start_date || '').slice(0, 4)) || 0;
}

function classifyPositions(positions = []) {
  const currentPositions = positions.filter((position) => position.current);
  const relevantPositions = currentPositions.length
    ? currentPositions
    : positions.slice().sort((left, right) => positionSortValue(right) - positionSortValue(left)).slice(0, 2);
  const ranks = relevantPositions.map((position) => String(position.rank || '').toUpperCase());
  if (ranks.some((rank) => STUDENT_RANKS.has(rank))) {
    return 'explicit student';
  }
  if (ranks.some((rank) => JUNIOR_RANKS.has(rank))) {
    return 'junior';
  }
  return 'unverified';
}

function buildAuthorUrl(record) {
  const controlNumber = record?.metadata?.control_number || record?.id;
  if (!controlNumber) {
    return '';
  }
  return `https://inspirehep.net/authors/${controlNumber}`;
}

function matchScore(record, { name, institution, orcid }) {
  const recordName = record?.metadata?.name?.value || '';
  const recordInstitution = record?.metadata?.positions?.find((item) => item.current)?.institution || record?.metadata?.positions?.[0]?.institution || '';
  const nameMatch = nameScore(recordName, name);
  const institutionMatch = institution ? institutionScore(recordInstitution, institution) : 0;
  const orcidMatch = stripOrcid(orcid) && recordOrcids(record).includes(stripOrcid(orcid)) ? 1 : 0;

  return {
    total: Math.min(1, orcidMatch * 0.7 + nameMatch * 0.25 + institutionMatch * 0.05),
    nameMatch,
    institutionMatch,
    orcidMatch,
  };
}

function selectRecord(records, context) {
  const scored = records
    .map((record) => ({
      record,
      ...matchScore(record, context),
    }))
    .sort((left, right) => right.total - left.total || right.nameMatch - left.nameMatch || right.institutionMatch - left.institutionMatch);

  const best = scored[0];
  if (!best) {
    return null;
  }

  if (best.orcidMatch) {
    return best;
  }

  if (best.nameMatch >= 0.96) {
    return best;
  }

  if (best.nameMatch >= 0.88 && best.institutionMatch >= 0.72) {
    return best;
  }

  return null;
}

export async function lookupInspireIdentityEvidence({ name, institution = '', orcid = '', fetchImpl = fetch }) {
  if (!name) {
    return null;
  }

  const url = new URL('https://inspirehep.net/api/authors');
  url.searchParams.set('q', name);
  url.searchParams.set('size', '5');
  url.searchParams.set('page', '1');

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Professor Research Evidence Dashboard/0.2',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`INSPIRE request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const records = payload?.hits?.hits || [];
  const best = selectRecord(records, { name, institution, orcid });

  if (!best) {
    return null;
  }

  const positions = best.record?.metadata?.positions || [];
  return {
    label: classifyPositions(positions),
    source: 'INSPIRE-HEP',
    sourceUrl: buildAuthorUrl(best.record),
    matchedName: best.record?.metadata?.name?.value || name,
    evidenceText: summarizePositions(positions) || 'Matched INSPIRE author record without explicit position metadata.',
    positions,
    matchMode: best.orcidMatch ? 'orcid' : 'name+institution',
  };
}
