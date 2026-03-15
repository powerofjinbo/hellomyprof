const USER_AGENT = 'Professor Research Evidence Dashboard/0.4';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitName(value) {
  const tokens = normalizeText(value).split(/\s+/).filter(Boolean);
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

function institutionVariants(value) {
  const raw = normalizeText(value);
  if (!raw) return [];

  const variants = new Set([raw]);
  variants.add(raw.replace(/\buniversity of california\b/g, 'uc'));
  variants.add(raw.replace(/\buniversity\b/g, 'u'));

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length) {
    variants.add(tokens.map((token) => token[0]).join(''));
  }

  return Array.from(variants).filter(Boolean);
}

function canonicalInstitutionText(value) {
  return normalizeText(value).replace(/\buniversity of california\b/g, 'uc').replace(/\buniversity\b/g, 'u');
}

function institutionSimilarity(left, right) {
  let best = 0;
  for (const leftVariant of institutionVariants(left)) {
    for (const rightVariant of institutionVariants(right)) {
      const textScore = textSimilarity(leftVariant, rightVariant);
      const leftTokens = new Set(leftVariant.split(/\s+/).filter(Boolean));
      const rightTokens = new Set(rightVariant.split(/\s+/).filter(Boolean));
      let overlap = 0;
      for (const token of leftTokens) {
        if (rightTokens.has(token)) overlap += 1;
      }
      const precision = leftTokens.size ? overlap / leftTokens.size : 0;
      const recall = rightTokens.size ? overlap / rightTokens.size : 0;
      const harmonic = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
      best = Math.max(best, textScore * 0.45 + harmonic * 0.55);
    }
  }
  return best;
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
  return Array.from(new Set(normalizeText(value).split(/\s+/).filter((token) => token.length > 2)));
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

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    url,
    text,
  };
}

function extractRelayStore(html) {
  const match = String(html || '').match(/window\.__RELAY_STORE__\s*=\s*(\{.*?\});/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function collectRelayEntities(store, typename) {
  if (!store || typeof store !== 'object') return [];
  return Object.values(store).filter((entry) => entry && typeof entry === 'object' && entry.__typename === typename);
}

function stripTags(value) {
  return String(value || '')
    .replace(/<!--.*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSchoolCards(html) {
  const matches = [];
  const regex = /<a[^>]+aria-label="Link to school page for ([^"]+)"[^>]+href="\/school\/(\d+)"/g;
  let match = regex.exec(html);
  while (match) {
    matches.push({
      name: match[1],
      legacyId: Number(match[2]),
    });
    match = regex.exec(html);
  }
  return matches;
}

function extractTeacherCards(html) {
  const cards = [];
  const regex = /<a class="TeacherCard__StyledTeacherCard[\s\S]*?href="\/professor\/(\d+)"[\s\S]*?>([\s\S]*?)<\/a>/g;
  let match = regex.exec(html);
  while (match) {
    const block = match[2];
    const name = stripTags(block.match(/<div class="CardName[^"]*">([\s\S]*?)<\/div>/)?.[1] || '');
    const department = stripTags(block.match(/<div class="CardSchool__Department[^"]*">([\s\S]*?)<\/div>/)?.[1] || '');
    const school = stripTags(block.match(/<div class="CardSchool__School[^"]*">([\s\S]*?)<\/div>/)?.[1] || '');
    const rating = Number.parseFloat(stripTags(block.match(/<div class="CardNumRating__CardNumRatingNumber[^"]*">([\s\S]*?)<\/div>/)?.[1] || ''));
    const ratingsText = stripTags(block.match(/<div class="CardNumRating__CardNumRatingCount[^"]*">([\s\S]*?)<\/div>/)?.[1] || '');
    const ratingCount = Number.parseInt(ratingsText.replace(/[^\d]/g, ''), 10);
    const feedbackNumbers = Array.from(block.matchAll(/<div class="CardFeedback__CardFeedbackNumber[^"]*">([\s\S]*?)<\/div>/g)).map((entry) => stripTags(entry[1]));

    cards.push({
      legacyId: Number(match[1]),
      name,
      department,
      school,
      avgRating: Number.isFinite(rating) ? rating : null,
      numRatings: Number.isFinite(ratingCount) ? ratingCount : null,
      wouldTakeAgainPercent: feedbackNumbers[0] ? Number.parseFloat(feedbackNumbers[0].replace(/[^\d.]/g, '')) : null,
      avgDifficulty: feedbackNumbers[1] ? Number.parseFloat(feedbackNumbers[1].replace(/[^\d.]/g, '')) : null,
    });

    match = regex.exec(html);
  }
  return cards;
}

function buildRmpSchoolSearchUrl(institution) {
  return `https://www.ratemyprofessors.com/search/schools?q=${encodeURIComponent(institution)}`;
}

function buildRmpProfessorSearchUrl(name, schoolId = '') {
  if (schoolId) {
    return `https://www.ratemyprofessors.com/search/professors/${encodeURIComponent(schoolId)}?q=${encodeURIComponent(name)}`;
  }
  return `https://www.ratemyprofessors.com/search/professors?q=${encodeURIComponent(name)}`;
}

function selectBestSchool(schools, institution) {
  const canonicalQuery = canonicalInstitutionText(institution);
  const queryTokens = new Set(canonicalQuery.split(/\s+/).filter(Boolean));
  const queryLooksExtended = /\b(extension|continuing|online)\b/i.test(institution);
  const scored = schools
    .map((school) => {
      const canonicalSchool = canonicalInstitutionText(school.name || '');
      const schoolTokens = new Set(canonicalSchool.split(/\s+/).filter(Boolean));
      let overlap = 0;
      for (const token of schoolTokens) {
        if (queryTokens.has(token)) overlap += 1;
      }
      const extraPenalty = schoolTokens.size ? (schoolTokens.size - overlap) / schoolTokens.size : 0;
      const extensionPenalty = !queryLooksExtended && /\b(extension|continuing|online)\b/i.test(school.name || '') ? 0.25 : 0;
      return {
        school,
        score: institutionSimilarity(school.name || '', institution) - extraPenalty * 0.2 - extensionPenalty,
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best || best.score < 0.48) return null;
  return best.school;
}

function teacherName(teacher) {
  if (teacher.name) return teacher.name;
  return [teacher.firstName, teacher.lastName].filter(Boolean).join(' ').trim();
}

function selectBestTeacher(teachers, { name, institution, researchField, schoolName = '' }) {
  const scored = teachers
    .map((teacher) => {
      const fullName = teacherName(teacher);
      const nameScore = nameSimilarity(fullName, name);
      const schoolScore = institution ? institutionSimilarity(schoolName || '', institution) : 0.55;
      const fieldScore = researchField ? jaccard(tokenize(teacher.department || ''), tokenize(researchField)) : 0.55;
      return {
        teacher,
        score: nameScore * 0.76 + schoolScore * 0.16 + fieldScore * 0.08,
        nameScore,
        schoolScore,
        fieldScore,
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (!best) return null;
  if (best.nameScore >= 0.88) return best;
  if (best.nameScore >= 0.74 && best.schoolScore >= 0.48) return best;
  return null;
}

export async function lookupRateMyProfessors({ name, institution = '', researchField = '', fetchImpl = fetch }) {
  if (!name) return null;

  try {
    const genericSearchUrl = buildRmpProfessorSearchUrl(name);
    const genericResponse = await fetchText(genericSearchUrl, fetchImpl);
    let matchedTeacher = selectBestTeacher(extractTeacherCards(genericResponse.text), {
      name,
      institution,
      researchField,
      schoolName: institution,
    });
    let matchedSchool = matchedTeacher?.teacher?.school ? { name: matchedTeacher.teacher.school } : null;
    let teacherSearchUrl = genericSearchUrl;

    if (!matchedTeacher && institution) {
      const schoolSearchUrl = buildRmpSchoolSearchUrl(institution);
      const schoolResponse = await fetchText(schoolSearchUrl, fetchImpl);
      const schoolStore = extractRelayStore(schoolResponse.text);
      matchedSchool = selectBestSchool(
        [...extractSchoolCards(schoolResponse.text), ...collectRelayEntities(schoolStore, 'School')],
        institution,
      );

      teacherSearchUrl = buildRmpProfessorSearchUrl(name, matchedSchool?.legacyId || '');
      const teacherResponse = await fetchText(teacherSearchUrl, fetchImpl);
      const teacherStore = extractRelayStore(teacherResponse.text);
      matchedTeacher = selectBestTeacher(
        [...extractTeacherCards(teacherResponse.text), ...collectRelayEntities(teacherStore, 'Teacher')],
        {
          name,
          institution,
          researchField,
          schoolName: matchedSchool?.name || '',
        },
      );
    }

    if (!matchedTeacher) {
      return {
        source: 'Rate My Professors',
        category: 'subjective-teaching',
        status: 'unavailable',
        searchUrl: teacherSearchUrl,
        note: 'No confidently matched Rate My Professors profile was found. This source is excluded from research scoring.',
      };
    }

    const teacher = matchedTeacher.teacher;
    return {
      source: 'Rate My Professors',
      category: 'subjective-teaching',
      status: 'matched',
      searchUrl: teacherSearchUrl,
      profileUrl: teacher.legacyId ? `https://www.ratemyprofessors.com/professor/${teacher.legacyId}` : teacherSearchUrl,
      school: matchedSchool?.name || institution || '',
      department: teacher.department || '',
      avgRating: teacher.avgRating ?? null,
      numRatings: teacher.numRatings ?? null,
      wouldTakeAgainPercent: teacher.wouldTakeAgainPercent ?? null,
      avgDifficulty: teacher.avgDifficulty ?? null,
      matchConfidence: Math.round(matchedTeacher.score * 100),
      note: 'Teaching-feedback source only. Subjective and excluded from research-score calculations.',
    };
  } catch (error) {
    return {
      source: 'Rate My Professors',
      category: 'subjective-teaching',
      status: 'error',
      searchUrl: buildRmpProfessorSearchUrl(name),
      note: error instanceof Error ? error.message : 'Rate My Professors lookup failed unexpectedly.',
    };
  }
}

function buildResearchGateSearchUrl(name, institution = '') {
  const query = [name, institution].filter(Boolean).join(' ');
  return `https://www.researchgate.net/search?q=${encodeURIComponent(query)}&type=researcher`;
}

export async function lookupResearchGate({ name, institution = '', fetchImpl = fetch }) {
  if (!name) return null;

  const searchUrl = buildResearchGateSearchUrl(name, institution);
  try {
    const response = await fetchText(searchUrl, fetchImpl);
    if (response.status === 403 || /attention required|forbidden|cloudflare/i.test(response.text)) {
      return {
        source: 'ResearchGate',
        category: 'public-web-profile',
        status: 'blocked',
        searchUrl,
        note: 'ResearchGate blocked automated access from this environment.',
      };
    }

    return {
      source: 'ResearchGate',
      category: 'public-web-profile',
      status: response.ok ? 'available' : 'unavailable',
      searchUrl,
      note: response.ok
        ? 'ResearchGate search page is reachable, but no reliable profile parser is enabled yet.'
        : 'ResearchGate search did not return an accessible result page.',
    };
  } catch (error) {
    return {
      source: 'ResearchGate',
      category: 'public-web-profile',
      status: 'error',
      searchUrl,
      note: error instanceof Error ? error.message : 'ResearchGate lookup failed unexpectedly.',
    };
  }
}

function buildZoteroSearchUrl(name, institution = '') {
  const query = [name, institution].filter(Boolean).join(' ');
  return `https://www.zotero.org/search?q=${encodeURIComponent(query)}`;
}

export async function lookupZotero({ name, institution = '', fetchImpl = fetch }) {
  if (!name) return null;

  const searchUrl = buildZoteroSearchUrl(name, institution);
  try {
    const response = await fetchText(searchUrl, fetchImpl);
    return {
      source: 'Zotero',
      category: 'public-bibliography',
      status: response.ok ? 'available' : 'unavailable',
      searchUrl,
      note: response.ok
        ? 'Zotero search is publicly reachable, but no reliable global professor-identity parser is available yet.'
        : 'Zotero search did not return an accessible result page.',
    };
  } catch (error) {
    return {
      source: 'Zotero',
      category: 'public-bibliography',
      status: 'error',
      searchUrl,
      note: error instanceof Error ? error.message : 'Zotero lookup failed unexpectedly.',
    };
  }
}

export async function lookupSupplementalSources({ name, institution = '', researchField = '', fetchImpl = fetch }) {
  const [rateMyProfessors, researchGate, zotero] = await Promise.all([
    lookupRateMyProfessors({ name, institution, researchField, fetchImpl }),
    lookupResearchGate({ name, institution, fetchImpl }),
    lookupZotero({ name, institution, fetchImpl }),
  ]);

  return {
    rateMyProfessors,
    researchGate,
    zotero,
  };
}
