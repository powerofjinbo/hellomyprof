const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'lab',
  'group',
  'center',
  'centre',
  'department',
  'school',
  'university',
  'professor',
]);

function currentDate() {
  return new Date();
}

function currentYear() {
  return currentDate().getFullYear();
}

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreToPercent(score) {
  return Math.round(clamp(score, 0, 1) * 100);
}

function logRatio(value, reference) {
  return clamp(Math.log1p(Math.max(0, value)) / Math.log1p(reference));
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token)),
    ),
  );
}

function jaccard(leftTokens, rightTokens) {
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

  return overlap / new Set([...left, ...right]).size;
}

function exactishMatch(value, query) {
  const source = String(value || '').toLowerCase().trim();
  const target = String(query || '').toLowerCase().trim();

  if (!source || !target) {
    return 0;
  }

  if (source === target) {
    return 1;
  }

  if (source.includes(target) || target.includes(source)) {
    return 0.84;
  }

  return 0.48 * jaccard(tokenize(source), tokenize(target));
}

function textList(tokensOrValues) {
  return tokensOrValues.filter(Boolean).join(' ');
}

function collectAuthorText(author) {
  const topics = (author.topics || []).map((topic) => topic.display_name);
  const concepts = (author.x_concepts || []).slice(0, 8).map((concept) => concept.display_name);
  const institutions = (author.last_known_institutions || []).map((item) => item.display_name);
  return textList([author.display_name, ...topics, ...concepts, ...institutions]);
}

function collectWorkText(works) {
  return textList(
    works.flatMap((work) => [
      work.primary_topic?.display_name,
      ...(work.topics || []).slice(0, 3).map((topic) => topic.display_name),
      ...(work.keywords || []).slice(0, 4).map((keyword) => keyword.display_name),
      work.primary_location?.source?.display_name,
      work.type,
    ]),
  );
}

export function pickInstitution(author, institutionHint = '') {
  return pickInstitutionForHint(author, institutionHint);
}

function institutionRecords(author) {
  const seen = new Set();
  const records = [];
  for (const item of author.last_known_institutions || []) {
    if (item?.display_name && !seen.has(item.display_name)) {
      seen.add(item.display_name);
      records.push(item);
    }
  }
  for (const item of author.affiliations || []) {
    const institution = item?.institution;
    if (institution?.display_name && !seen.has(institution.display_name)) {
      seen.add(institution.display_name);
      records.push(institution);
    }
  }
  return records;
}

function pickInstitutionForHint(author, institutionHint = '') {
  const records = institutionRecords(author);
  if (!records.length) {
    return 'Institution unavailable';
  }

  if (!institutionHint) {
    return records[0]?.display_name || 'Institution unavailable';
  }

  return (
    records
      .slice()
      .sort((left, right) => exactishMatch(right.display_name, institutionHint) - exactishMatch(left.display_name, institutionHint))[0]
      ?.display_name || records[0]?.display_name || 'Institution unavailable'
  );
}

function institutionType(author, institutionHint = '') {
  const records = institutionRecords(author);
  if (!records.length) {
    return null;
  }

  if (!institutionHint) {
    return records[0]?.type || null;
  }

  return (
    records
      .slice()
      .sort((left, right) => exactishMatch(right.display_name, institutionHint) - exactishMatch(left.display_name, institutionHint))[0]
      ?.type || records[0]?.type || null
  );
}

function bestInstitutionMatch(author, institutionHint = '') {
  if (!institutionHint) {
    return 0;
  }

  return institutionRecords(author).reduce(
    (best, record) => Math.max(best, exactishMatch(record.display_name, institutionHint)),
    0,
  );
}

function firstKnownTopic(author) {
  return author.topics?.[0]?.display_name || author.x_concepts?.[0]?.display_name || 'Topic unavailable';
}

function extractCountsByYear(author) {
  const entries = new Map();
  for (const item of author.counts_by_year || []) {
    if (Number.isFinite(item.year)) {
      entries.set(item.year, item.works_count || 0);
    }
  }
  return entries;
}

export function buildTimeline(author, yearsBack = 8) {
  const counts = extractCountsByYear(author);
  const endYear = currentYear();
  const timeline = [];
  for (let year = endYear - yearsBack + 1; year <= endYear; year += 1) {
    timeline.push({
      year,
      count: counts.get(year) || 0,
    });
  }

  const peak = Math.max(...timeline.map((item) => item.count), 1);
  return timeline.map((item) => ({
    ...item,
    height: clamp(item.count / peak),
  }));
}

function recentOutputStats(author) {
  const timeline = buildTimeline(author, 8);
  const recentThree = timeline.slice(-3);
  const previousThree = timeline.slice(-6, -3);
  const recentAverage = average(recentThree.map((item) => item.count));
  const previousAverage = average(previousThree.map((item) => item.count));
  const recentTotal = recentThree.reduce((sum, item) => sum + item.count, 0);
  return {
    timeline,
    recentAverage,
    previousAverage,
    recentTotal,
  };
}

export function computeFieldAlignment(author, works, researchField) {
  const queryTokens = tokenize(researchField);
  if (!queryTokens.length) {
    return 0.58;
  }

  const authorTokens = tokenize(collectAuthorText(author));
  const workTokens = tokenize(collectWorkText(works));
  const corpus = new Set([...authorTokens, ...workTokens]);
  const overlapCount = queryTokens.filter((token) => corpus.has(token)).length;
  const recall = overlapCount / queryTokens.length;
  const spread = jaccard(queryTokens, [...corpus]);
  return clamp(recall * 0.7 + spread * 0.3);
}

function computeFieldAlignmentForRanking(author, researchField) {
  return computeFieldAlignment(author, [], researchField);
}

function normalizeAuthorId(value) {
  return String(value || '').split('/').pop();
}

function authorIdSet(authorRef) {
  if (Array.isArray(authorRef)) {
    return new Set(authorRef.map(normalizeAuthorId).filter(Boolean));
  }

  if (typeof authorRef === 'object' && authorRef) {
    return new Set([normalizeAuthorId(authorRef.id), ...((authorRef.mergedAuthorIds || []).map(normalizeAuthorId))].filter(Boolean));
  }

  return new Set([normalizeAuthorId(authorRef)].filter(Boolean));
}

function authorshipFor(work, authorRef) {
  const ids = authorIdSet(authorRef);
  return (work.authorships || []).find((authorship) => ids.has(normalizeAuthorId(authorship.author?.id)));
}

function meanFwci(works) {
  const values = works.map((work) => Number(work.fwci)).filter((value) => Number.isFinite(value));
  return average(values);
}

function meanCitationPercentile(works) {
  const values = works
    .map((work) => Number(work.citation_normalized_percentile?.value))
    .filter((value) => Number.isFinite(value));
  return average(values);
}

function share(works, predicate) {
  if (!works.length) {
    return 0;
  }

  return works.filter(predicate).length / works.length;
}

export function summarizeWorks(works, authorRef) {
  const relevantWorks = works.filter((work) => authorshipFor(work, authorRef));
  if (!relevantWorks.length) {
    return {
      sampleSize: 0,
      meanPercentile: 0,
      topTenShare: 0,
      coreVenueShare: 0,
      openAccessShare: 0,
      meanFwci: 0,
      meanTeamSize: 0,
      correspondingShare: 0,
      firstAuthorShare: 0,
      latestPublicationDate: null,
      latestPublicationLabel: 'Unknown',
    };
  }

  const authorRows = relevantWorks.map((work) => authorshipFor(work, authorRef));
  const meanTeamSize = average(relevantWorks.map((work) => work.authorships?.length || 1));
  const latestPublication = relevantWorks
    .map((work) => work.publication_date || `${work.publication_year || ''}-01-01`)
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    sampleSize: relevantWorks.length,
    meanPercentile: meanCitationPercentile(relevantWorks),
    topTenShare: share(relevantWorks, (work) => Boolean(work.citation_normalized_percentile?.is_in_top_10_percent)),
    coreVenueShare: share(relevantWorks, (work) => Boolean(work.primary_location?.source?.is_core)),
    openAccessShare: share(relevantWorks, (work) => Boolean(work.open_access?.is_oa)),
    meanFwci: meanFwci(relevantWorks),
    meanTeamSize,
    correspondingShare: share(authorRows, (authorship) => Boolean(authorship?.is_corresponding)),
    firstAuthorShare: share(authorRows, (authorship) => authorship?.author_position === 'first'),
    latestPublicationDate: latestPublication,
    latestPublicationLabel: latestPublication || 'Unknown',
  };
}

function monthsSince(dateString) {
  if (!dateString) {
    return 24;
  }

  const value = new Date(dateString);
  if (Number.isNaN(value.getTime())) {
    return 24;
  }

  const deltaMs = currentDate().getTime() - value.getTime();
  return Math.max(0, deltaMs / (1000 * 60 * 60 * 24 * 30.4375));
}

function grade(score) {
  if (score >= 85) return 'Exceptional';
  if (score >= 72) return 'Strong';
  if (score >= 58) return 'Promising';
  if (score >= 44) return 'Mixed';
  return 'Caution';
}

function confidenceLabel(score) {
  if (score >= 80) return 'High confidence';
  if (score >= 62) return 'Medium confidence';
  return 'Low confidence';
}

function scoreMetric(value, reference, mode = 'log') {
  if (mode === 'linear') {
    return clamp(value / reference);
  }

  return logRatio(value, reference);
}

function scoreInfluence(author) {
  const hIndex = author.summary_stats?.h_index || 0;
  const citedBy = author.cited_by_count || 0;
  const worksCount = author.works_count || 0;

  return scoreToPercent(
    scoreMetric(citedBy, 150000, 'log') * 0.42 +
      scoreMetric(hIndex, 120, 'log') * 0.38 +
      scoreMetric(worksCount, 600, 'log') * 0.2,
  );
}

function scorePaperQuality(workSummary) {
  return scoreToPercent(
    workSummary.meanPercentile * 0.46 +
      workSummary.topTenShare * 0.24 +
      workSummary.coreVenueShare * 0.18 +
      clamp(workSummary.meanFwci / 4) * 0.12,
  );
}

function scoreOutputVolume(author, outputStats) {
  return scoreToPercent(
    scoreMetric(author.works_count || 0, 500, 'log') * 0.7 +
      clamp(outputStats.recentAverage / 8) * 0.3,
  );
}

function scoreMomentum(workSummary, outputStats) {
  const recency = 1 - clamp(monthsSince(workSummary.latestPublicationDate) / 24);
  const cadence = clamp(outputStats.recentAverage / 6);
  const growth = clamp((outputStats.recentAverage - outputStats.previousAverage + 2) / 6);
  return scoreToPercent(recency * 0.4 + cadence * 0.4 + growth * 0.2);
}

function scoreMentorshipProxy(author, workSummary, outputStats, institutionHint = '') {
  const teamSizeScore = clamp((10 - Math.max(workSummary.meanTeamSize, 1)) / 8);
  const institutionScore = institutionType(author, institutionHint) === 'education' ? 1 : 0.65;
  return scoreToPercent(
    workSummary.correspondingShare * 0.32 +
      workSummary.firstAuthorShare * 0.16 +
      teamSizeScore * 0.22 +
      clamp(outputStats.recentAverage / 6) * 0.2 +
      institutionScore * 0.1,
  );
}

function scoreTrackScores({ influence, quality, volume, momentum, mentorship, fieldFit, websiteSignals = null }) {
  const field = fieldFit / 100;
  const inf = influence / 100;
  const qual = quality / 100;
  const vol = volume / 100;
  const mom = momentum / 100;
  const mentor = mentorship / 100;
  const baseScores = {
    undergraduate: scoreToPercent(field * 0.3 + mom * 0.24 + mentor * 0.24 + vol * 0.12 + qual * 0.1),
    masters: scoreToPercent(field * 0.25 + mom * 0.22 + qual * 0.2 + mentor * 0.18 + inf * 0.08 + vol * 0.07),
    phd: scoreToPercent(inf * 0.3 + qual * 0.24 + mom * 0.18 + field * 0.16 + mentor * 0.06 + vol * 0.06),
  };

  const websiteConfidence = clamp((websiteSignals?.confidence || 0) / 100);
  if (!websiteConfidence) {
    return baseScores;
  }

  const websiteVisibility = (websiteSignals?.metrics?.websiteVisibility || 0) / 100;
  const websiteFreshness = (websiteSignals?.metrics?.websiteFreshness || 0) / 100;
  const studentOpportunity = (websiteSignals?.metrics?.studentOpportunity || 0) / 100;
  const websiteTrack = websiteSignals?.trackSignals || {};
  const websiteBlendScores = {
    undergraduate: scoreToPercent(
      clamp((websiteTrack.undergraduate || 0) / 100) * 0.68 +
        studentOpportunity * 0.18 +
        websiteVisibility * 0.1 +
        websiteFreshness * 0.04,
    ),
    masters: scoreToPercent(
      clamp((websiteTrack.masters || 0) / 100) * 0.64 +
        studentOpportunity * 0.18 +
        websiteVisibility * 0.08 +
        websiteFreshness * 0.1,
    ),
    phd: scoreToPercent(
      clamp((websiteTrack.phd || 0) / 100) * 0.66 +
        studentOpportunity * 0.14 +
        websiteVisibility * 0.08 +
        websiteFreshness * 0.12,
    ),
  };

  return {
    undergraduate: Math.round(baseScores.undergraduate * (1 - 0.18 * websiteConfidence) + websiteBlendScores.undergraduate * (0.18 * websiteConfidence)),
    masters: Math.round(baseScores.masters * (1 - 0.15 * websiteConfidence) + websiteBlendScores.masters * (0.15 * websiteConfidence)),
    phd: Math.round(baseScores.phd * (1 - 0.1 * websiteConfidence) + websiteBlendScores.phd * (0.1 * websiteConfidence)),
  };
}

function buildStrengths(metrics, trackScores, websiteSignals, collaborationInsights) {
  const candidates = [
    [metrics.influence, `Influence is ${grade(metrics.influence).toLowerCase()} with ${metrics.hIndex} h-index and ${metrics.citationsLabel} citations.`],
    [metrics.paperQuality, `Recent paper quality is ${grade(metrics.paperQuality).toLowerCase()}, supported by a ${metrics.topTenLabel} top-10% paper share.`],
    [metrics.momentum, `Publishing momentum is ${grade(metrics.momentum).toLowerCase()} with ${metrics.latestPublicationLabel} as the latest publication signal.`],
    [metrics.repeatCollaboration, `Recurring collaboration strength is ${grade(metrics.repeatCollaboration).toLowerCase()}, indicating repeated joint output with the same coauthors.`],
    [metrics.seniorCollaboratorSignal, `Senior-collaborator signal is ${grade(metrics.seniorCollaboratorSignal).toLowerCase()} across the sampled coauthor network.`],
  ];

  if ((websiteSignals?.confidence || 0) >= 35) {
    candidates.push([
      metrics.evidenceCoverage,
      `Verified institutional website coverage is ${grade(metrics.evidenceCoverage).toLowerCase()}, with ${websiteSignals.verifiedPages.length} verified page${websiteSignals.verifiedPages.length === 1 ? '' : 's'} contributing to the report.`,
    ]);
  }

  return candidates
    .sort((left, right) => right[0] - left[0])
    .slice(0, 3)
    .map((item) => item[1]);
}

function buildRisks(metrics, workSummary, fieldFitScore, websiteSignals, collaborationInsights) {
  const risks = [];

  if (fieldFitScore < 60) {
    risks.push('Research-area overlap is only partial. Read several recent abstracts before treating this as a true topic match.');
  }

  if (metrics.momentum < 55) {
    risks.push('Recent publishing cadence is modest, which may limit near-term project velocity or submission opportunities.');
  }

  if (workSummary.meanTeamSize >= 9) {
    risks.push('Large team sizes suggest that day-to-day supervision may be delegated or collaboration-heavy.');
  }

  if (metrics.paperQuality < 58) {
    risks.push('The recent work sample is not consistently high in normalized citation percentile or top-tier venue proxy metrics.');
  }

  if ((websiteSignals?.confidence || 0) < 40) {
    risks.push('Verified external-source coverage is limited, so source-boundary evidence stays thin for this report.');
  }

  if (metrics.seniorCollaboratorSignal < 35) {
    risks.push('The sampled coauthor network does not currently show strong repeated collaboration with established senior researchers.');
  }

  if (metrics.repeatCollaboration < 35) {
    risks.push('Recurring collaboration signal is limited in the sampled publication window, which can make group structure harder to interpret.');
  }

  return risks.slice(0, 4);
}

function buildManualChecks(metrics, workSummary, author, audience, websiteSignals, institutionHint = '') {
  const checks = [
    'Inspect 3 to 5 recent papers and identify which collaborators recur over time.',
    'Verify which collaborators are students, postdocs, or faculty using explicit public records before drawing conclusions.',
    'Verify response time, funding availability, and day-to-day supervision expectations before reaching out.',
  ];

  if (workSummary.meanTeamSize >= 8) {
    checks.push('Confirm whether new students own independent subproblems or mainly join existing large-team pipelines.');
  }

  if (institutionType(author, institutionHint) !== 'education') {
    checks.push('Current affiliation is not a standard university department. Verify formal advising and thesis supervision structure.');
  }

  if (!(websiteSignals?.officialSources || []).length) {
    checks.push('No official professor or lab page was recovered automatically. Search the university site manually before making a decision.');
  }

  return Array.from(new Set(checks)).slice(0, 5);
}

function buildTrackNarrative(track, score) {
  if (track === 'undergraduate') {
    if (score >= 75) {
      return 'High signal on field fit, recent activity, and project visibility, but undergraduate publication access still needs explicit verification.';
    }
    if (score >= 58) {
      return 'Moderate signal for undergraduate research access. Treat this as a screening result, not proof of publication opportunity.';
    }
    return 'Limited automatic evidence for undergraduate research access. Manual confirmation remains necessary.';
  }

  if (track === 'masters') {
    if (score >= 75) {
      return "High signal for a research-oriented master's path based on recent output, topic fit, and project visibility.";
    }
    if (score >= 58) {
      return "Moderate master's signal. Advisor bandwidth and project ownership still need direct confirmation.";
    }
    return "Current data gives only limited support for a master's research path without more direct evidence.";
  }

  if (score >= 78) {
    return 'High doctoral signal based on influence, quality, momentum, and field fit.';
  }
  if (score >= 62) {
    return 'Moderate doctoral signal with remaining uncertainty around advisor bandwidth, project shape, or recent evidence.';
  }
  return 'Current doctoral signal is limited relative to stronger peers in the same field.';
}

function normalizeDoi(doi) {
  if (!doi) return null;
  const raw = String(doi).trim();
  if (raw.startsWith('https://doi.org/')) return raw;
  if (raw.startsWith('http://doi.org/')) return raw.replace('http://', 'https://');
  if (raw.startsWith('10.')) return `https://doi.org/${raw}`;
  return null;
}

export function pickTopWorks(works, authorRef, limit = 5) {
  return works
    .filter((work) => authorshipFor(work, authorRef))
    .slice()
    .sort((left, right) => {
      const leftScore =
        (left.citation_normalized_percentile?.value || 0) * 0.45 +
        (left.citation_normalized_percentile?.is_in_top_10_percent ? 0.22 : 0) +
        clamp((left.cited_by_count || 0) / 250) * 0.2 +
        clamp(1 - monthsSince(left.publication_date) / 36) * 0.13;
      const rightScore =
        (right.citation_normalized_percentile?.value || 0) * 0.45 +
        (right.citation_normalized_percentile?.is_in_top_10_percent ? 0.22 : 0) +
        clamp((right.cited_by_count || 0) / 250) * 0.2 +
        clamp(1 - monthsSince(right.publication_date) / 36) * 0.13;
      return rightScore - leftScore;
    })
    .slice(0, limit)
    .map((work) => ({
      title: work.display_name || work.title || 'Untitled work',
      year: work.publication_year || 'n.d.',
      venue: work.primary_location?.source?.display_name || work.type || 'Venue unavailable',
      citations: work.cited_by_count || 0,
      topTen: Boolean(work.citation_normalized_percentile?.is_in_top_10_percent),
      percentile: round(Number(work.citation_normalized_percentile?.value || 0) * 100, 1),
      link:
        work.primary_location?.landing_page_url ||
        work.best_oa_location?.landing_page_url ||
        normalizeDoi(work.ids?.doi || work.doi) ||
        work.id,
    }));
}

function summaryString(data) {
  const lines = [
    `${data.author.display_name} - overall signal ${data.overallScore}/100`,
    `Institution: ${data.institution}`,
    `Research focus: ${data.primaryTopic}`,
    `Influence: ${data.metrics.influence}/100 | Quality: ${data.metrics.paperQuality}/100 | Publication cadence: ${data.metrics.momentum}/100`,
    `Repeat collaboration: ${data.metrics.repeatCollaboration}/100 | Senior-collab signal: ${data.metrics.seniorCollaboratorSignal}/100 | Network breadth: ${data.metrics.collaborationBreadth}/100`,
    `Source confidence: ${data.confidenceScore}/100 | Verified source coverage: ${data.metrics.evidenceCoverage}/100`,
    `Key caution: coauthor identity labels remain unverified unless an external record exposes explicit career-stage metadata.`,
  ];

  if (data.author.mergedProfileCount > 1) {
    lines.push(`Identity resolution: merged ${data.author.mergedProfileCount} OpenAlex profiles for this report.`);
  }

  return lines.join('\n');
}

export function formatCompactNumber(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

const PROFILE_DIMENSIONS = [
  {
    key: 'overallScore',
    label: 'Overall',
    group: 'summary',
    accessor: (report) => report.overallScore,
  },
  {
    key: 'metrics.influence',
    label: 'Influence',
    group: 'core',
    accessor: (report) => report.metrics.influence,
  },
  {
    key: 'metrics.paperQuality',
    label: 'Paper quality',
    group: 'core',
    accessor: (report) => report.metrics.paperQuality,
  },
  {
    key: 'metrics.outputVolume',
    label: 'Output volume',
    group: 'core',
    accessor: (report) => report.metrics.outputVolume,
  },
  {
    key: 'metrics.momentum',
    label: 'Publication cadence',
    group: 'core',
    accessor: (report) => report.metrics.momentum,
  },
  {
    key: 'metrics.fieldFit',
    label: 'Field fit',
    group: 'core',
    accessor: (report) => report.metrics.fieldFit,
  },
  {
    key: 'metrics.repeatCollaboration',
    label: 'Repeat collaboration',
    group: 'core',
    accessor: (report) => report.metrics.repeatCollaboration,
  },
  {
    key: 'metrics.seniorCollaboratorSignal',
    label: 'Senior-collab signal',
    group: 'core',
    accessor: (report) => report.metrics.seniorCollaboratorSignal,
  },
  {
    key: 'metrics.collaborationBreadth',
    label: 'Network breadth',
    group: 'core',
    accessor: (report) => report.metrics.collaborationBreadth,
  },
];

export function buildScoreProfile(report) {
  return PROFILE_DIMENSIONS.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    group: dimension.group,
    value: dimension.accessor(report),
  }));
}

export function compareProfessorReports(reports) {
  const safeReports = reports.filter(Boolean);

  return {
    leaderboard: safeReports
      .map((report) => {
        return {
          authorId: report.author.id,
          name: report.author.display_name,
          institution: report.institution,
          overallScore: report.overallScore,
          confidenceScore: report.confidenceScore,
          fieldFit: report.metrics.fieldFit,
          momentum: report.metrics.momentum,
          repeatCollaboration: report.metrics.repeatCollaboration,
          seniorCollaboratorSignal: report.metrics.seniorCollaboratorSignal,
          queryContext: report.queryContext || null,
        };
      })
      .sort((left, right) => right.overallScore - left.overallScore),
    dimensions: PROFILE_DIMENSIONS.map((dimension) => {
      const scores = safeReports
        .map((report) => ({
          authorId: report.author.id,
          name: report.author.display_name,
          institution: report.institution,
          value: dimension.accessor(report),
        }))
        .sort((left, right) => right.value - left.value);

      return {
        key: dimension.key,
        label: dimension.label,
        group: dimension.group,
        leader: scores[0] || null,
        scores,
      };
    }),
  };
}

export function evaluateProfessor({
  author,
  works,
  researchField = '',
  audience = 'all',
  institutionHint = '',
  websiteSignals = null,
  collaborationInsights = null,
  externalProfiles = null,
}) {
  const institution = pickInstitutionForHint(author, institutionHint);
  const primaryTopic = firstKnownTopic(author);
  const outputStats = recentOutputStats(author);
  const workSummary = summarizeWorks(works, author);
  const fieldFit = scoreToPercent(computeFieldAlignment(author, works, researchField));
  const influence = scoreInfluence(author);
  const paperQuality = scorePaperQuality(workSummary);
  const outputVolume = scoreOutputVolume(author, outputStats);
  const momentum = scoreMomentum(workSummary, outputStats);
  const mentorshipProxy = scoreMentorshipProxy(author, workSummary, outputStats, institutionHint);
  const websiteMetrics = websiteSignals?.metrics || {
    evidenceCoverage: 0,
    verificationConfidence: 0,
  };
  const collaborationMetrics = collaborationInsights?.metrics || {
    repeatCollaboration: 0,
    seniorCollaboratorSignal: 0,
    recentCollaboration: 0,
    collaborationBreadth: 0,
    topPartnerConcentration: 0,
  };
  const overallScore = Math.round(
    influence * 0.23 +
      paperQuality * 0.2 +
      outputVolume * 0.14 +
      momentum * 0.17 +
      fieldFit * 0.1 +
      collaborationMetrics.repeatCollaboration * 0.07 +
      collaborationMetrics.seniorCollaboratorSignal * 0.05 +
      collaborationMetrics.collaborationBreadth * 0.04,
  );

  const confidenceScore = Math.round(
    Math.min(
      100,
      clamp(
        workSummary.sampleSize / 40,
        0,
        1,
      ) *
        45 +
        clamp(fieldFit / 100, 0.45, 1) * 20 +
        clamp(outputStats.timeline.some((item) => item.count > 0) ? 1 : 0, 0, 1) * 20 +
        clamp(workSummary.latestPublicationDate ? 1 : 0, 0, 1) * 15,
    ),
  );

  const metrics = {
    influence,
    paperQuality,
    outputVolume,
    momentum,
    fieldFit,
    mentorshipProxy,
    hIndex: author.summary_stats?.h_index || 0,
    worksCount: author.works_count || 0,
    evidenceCoverage: websiteMetrics.evidenceCoverage,
    verificationConfidence: websiteMetrics.verificationConfidence,
    repeatCollaboration: collaborationMetrics.repeatCollaboration,
    seniorCollaboratorSignal: collaborationMetrics.seniorCollaboratorSignal,
    recentCollaboration: collaborationMetrics.recentCollaboration,
    collaborationBreadth: collaborationMetrics.collaborationBreadth,
    topPartnerConcentration: collaborationMetrics.topPartnerConcentration,
    citationsLabel: formatCompactNumber(author.cited_by_count || 0),
    topTenLabel: `${Math.round(workSummary.topTenShare * 100)}%`,
    latestPublicationLabel: workSummary.latestPublicationLabel,
    sampleSize: workSummary.sampleSize,
  };

  const result = {
    author,
    institution,
    primaryTopic,
    queryContext: {
      researchField,
      audience,
    },
    overallScore,
    summaryGrade: grade(overallScore),
    confidenceScore,
    confidenceLabel: confidenceLabel(confidenceScore),
    metrics,
    strengths: buildStrengths(metrics, null, websiteSignals, collaborationInsights),
    risks: buildRisks(metrics, workSummary, fieldFit, websiteSignals, collaborationInsights),
    manualChecks: buildManualChecks(metrics, workSummary, author, audience, websiteSignals, institutionHint),
    timeline: outputStats.timeline,
    workSummary,
    topWorks: pickTopWorks(works, author),
    webSignals: websiteSignals || null,
    collaborationInsights: collaborationInsights || null,
    externalProfiles: externalProfiles || null,
  };

  result.summaryText = summaryString(result);
  result.scoreProfile = buildScoreProfile(result);
  return result;
}

export function rankAuthors(authors, query) {
  const name = query.professorName || '';
  const institution = query.institutionName || '';
  const researchField = query.researchField || '';

  return authors
    .map((author) => {
      const nameScore = exactishMatch(author.display_name, name);
      const institutionScore = bestInstitutionMatch(author, institution);
      const fieldScore = computeFieldAlignmentForRanking(author, researchField);
      return {
        ...author,
        matchScore: Math.round((nameScore * 0.58 + institutionScore * 0.17 + fieldScore * 0.25) * 100),
      };
    })
    .sort((left, right) => right.matchScore - left.matchScore || (right.cited_by_count || 0) - (left.cited_by_count || 0));
}

export function formatTrackLabel(key) {
  if (key === 'undergraduate') return 'Undergraduate';
  if (key === 'masters') return "Master's";
  return 'PhD';
}
