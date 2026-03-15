function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function scoreToPercent(score) {
  return Math.round(clamp(score, 0, 1) * 100);
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function authorIdKey(value) {
  return String(value || '').split('/').pop();
}

function authorIdSet(author) {
  return new Set([authorIdKey(author?.id), ...((author?.mergedAuthorIds || []).map(authorIdKey))].filter(Boolean));
}

function pickInstitution(profile) {
  return (
    profile?.last_known_institutions?.[0]?.display_name ||
    profile?.affiliations?.[0]?.institution?.display_name ||
    'Institution unavailable'
  );
}

function prominenceTier(profile) {
  const hIndex = profile?.summary_stats?.h_index || 0;
  const citations = profile?.cited_by_count || 0;
  if (hIndex >= 80 || citations >= 100000) {
    return 'Field-leading';
  }
  if (hIndex >= 45 || citations >= 25000) {
    return 'Senior';
  }
  if (hIndex >= 20 || citations >= 5000) {
    return 'Established';
  }
  return 'Emerging';
}

function isHighProfile(profile) {
  const hIndex = profile?.summary_stats?.h_index || 0;
  const citations = profile?.cited_by_count || 0;
  return hIndex >= 60 || citations >= 50000;
}

export async function buildCollaborationInsights({ author, works, fetchAuthorById, fetchIdentityEvidence = null }) {
  const professorIds = authorIdSet(author);
  const relevantWorks = works.filter((work) =>
    (work.authorships || []).some((authorship) => professorIds.has(authorIdKey(authorship.author?.id))),
  );

  if (!relevantWorks.length) {
    return {
      metrics: {
        repeatCollaboration: 0,
        seniorCollaboratorSignal: 0,
        recentCollaboration: 0,
        collaborationBreadth: 0,
        topPartnerConcentration: 0,
      },
      histogram: [],
      topCollaborators: [],
      highlights: [],
      caveats: ['No collaborator network could be built from the current work sample.'],
    };
  }

  const currentYear = new Date().getFullYear();
  const collaboratorMap = new Map();
  let totalCoauthorLinks = 0;

  for (const work of relevantWorks) {
    const publicationYear = Number(work.publication_year || currentYear);
    for (const authorship of work.authorships || []) {
      const collaboratorId = authorIdKey(authorship.author?.id);
      if (!collaboratorId || professorIds.has(collaboratorId)) {
        continue;
      }

      totalCoauthorLinks += 1;
      const entry = collaboratorMap.get(collaboratorId) || {
        id: authorship.author?.id || collaboratorId,
        name: authorship.author?.display_name || 'Unknown collaborator',
        workCount: 0,
        recentWorkCount: 0,
        citationLinkedWorks: 0,
        firstYear: publicationYear,
        lastYear: publicationYear,
        sampleTitles: [],
      };
      entry.workCount += 1;
      entry.citationLinkedWorks += work.cited_by_count || 0;
      entry.firstYear = Math.min(entry.firstYear, publicationYear);
      entry.lastYear = Math.max(entry.lastYear, publicationYear);
      if (publicationYear >= currentYear - 2) {
        entry.recentWorkCount += 1;
      }
      if (entry.sampleTitles.length < 2 && work.display_name) {
        entry.sampleTitles.push(work.display_name);
      }
      collaboratorMap.set(collaboratorId, entry);
    }
  }

  const collaborators = Array.from(collaboratorMap.values()).sort(
    (left, right) => right.workCount - left.workCount || right.recentWorkCount - left.recentWorkCount || right.citationLinkedWorks - left.citationLinkedWorks,
  );
  const topCollaborators = collaborators.slice(0, 6);
  const notableCandidates = collaborators
    .slice()
    .sort((left, right) => right.citationLinkedWorks - left.citationLinkedWorks || right.workCount - left.workCount)
    .slice(0, 6);
  const profileCandidates = Array.from(
    new Map([...topCollaborators, ...notableCandidates].map((item) => [authorIdKey(item.id), item])).values(),
  ).slice(0, 10);

  const collaboratorProfiles = await Promise.all(
    profileCandidates.map(async (collaborator) => {
      try {
        const profile = await fetchAuthorById(collaborator.id);
        return { collaborator, profile };
      } catch {
        return { collaborator, profile: null };
      }
    }),
  );

  const topCollaboratorRows = collaboratorProfiles.map(({ collaborator, profile }) => ({
    id: collaborator.id,
    name: collaborator.name,
    institution: pickInstitution(profile),
    orcid: profile?.ids?.orcid || '',
    workCount: collaborator.workCount,
    recentWorkCount: collaborator.recentWorkCount,
    lastYear: collaborator.lastYear,
    hIndex: profile?.summary_stats?.h_index || null,
    citations: profile?.cited_by_count || null,
    prominenceTier: prominenceTier(profile),
    highProfile: isHighProfile(profile),
    sampleTitles: collaborator.sampleTitles,
  }));
  const identityEvidenceRows = fetchIdentityEvidence
    ? await Promise.all(
        topCollaboratorRows.map(async (collaborator) => {
          try {
            return await fetchIdentityEvidence({
              name: collaborator.name,
              institution: collaborator.institution,
              orcid: collaborator.orcid,
            });
          } catch {
            return null;
          }
        }),
      )
    : topCollaboratorRows.map(() => null);
  const collaboratorRowsWithIdentity = topCollaboratorRows.map((collaborator, index) => ({
    ...collaborator,
    identityEvidence: identityEvidenceRows[index] || { label: 'unverified' },
  }));
  const topCollaboratorIds = new Set(topCollaborators.map((item) => authorIdKey(item.id)));
  const frequentCollaboratorRows = collaboratorRowsWithIdentity.filter((item) => topCollaboratorIds.has(authorIdKey(item.id)));
  const notableCollaborators = collaboratorRowsWithIdentity
    .filter((item) => item.highProfile)
    .sort((left, right) => (right.hIndex || 0) - (left.hIndex || 0) || (right.citations || 0) - (left.citations || 0))
    .slice(0, 4);

  const repeatCollaborators = collaborators.filter((item) => item.workCount >= 2);
  const highProfileRows = notableCollaborators;
  const repeatCollaboration = scoreToPercent(
    clamp(repeatCollaborators.length / 6) * 0.55 +
      clamp(average(repeatCollaborators.map((item) => item.workCount)) / 4) * 0.45,
  );
  const seniorCollaboratorSignal = scoreToPercent(
    clamp(highProfileRows.length / 3) * 0.55 +
      clamp(average(collaboratorRowsWithIdentity.map((item) => (item.hIndex || 0) / 80))) * 0.45,
  );
  const recentCollaboration = scoreToPercent(
    clamp(average(topCollaborators.map((item) => item.recentWorkCount)) / 3) * 0.65 +
      clamp(topCollaborators.filter((item) => item.lastYear >= currentYear - 1).length / Math.max(1, topCollaborators.length)) * 0.35,
  );
  const collaborationBreadth = scoreToPercent(
    clamp(collaborators.length / Math.max(8, relevantWorks.length * 1.1)) * 0.55 +
      clamp(topCollaborators.filter((item) => item.workCount >= 2).length / 5) * 0.45,
  );
  const topPartnerConcentration = scoreToPercent(
    clamp(
      topCollaborators
        .slice(0, 3)
        .reduce((sum, item) => sum + item.workCount, 0) / Math.max(1, totalCoauthorLinks),
    ),
  );

  const histogram = [
    { key: 'repeatCollaboration', label: 'Repeat collaborators', value: repeatCollaboration },
    { key: 'seniorCollaboratorSignal', label: 'Senior-collab signal', value: seniorCollaboratorSignal },
    { key: 'recentCollaboration', label: 'Recent-collab activity', value: recentCollaboration },
    { key: 'collaborationBreadth', label: 'Network breadth', value: collaborationBreadth },
    { key: 'topPartnerConcentration', label: 'Top-partner concentration', value: topPartnerConcentration },
  ];

  const highlights = [];
  if (repeatCollaborators.length) {
    highlights.push(`${repeatCollaborators.length} collaborators appear on multiple papers in the sampled publication window.`);
  }
  if (highProfileRows.length) {
    highlights.push(`${highProfileRows.length} collaborator${highProfileRows.length === 1 ? '' : 's'} in the sampled network clear the current high-profile threshold.`);
  }
  const explicitStudentCount = frequentCollaboratorRows.filter((item) => item.identityEvidence?.label === 'explicit student').length;
  if (explicitStudentCount) {
    highlights.push(`${explicitStudentCount} frequent collaborator${explicitStudentCount === 1 ? '' : 's'} carry explicit student-stage evidence from external records.`);
  }
  if (frequentCollaboratorRows[0]) {
    highlights.push(`${frequentCollaboratorRows[0].name} is the most frequent collaborator in the sampled work set.`);
  }

  const caveats = [];
  caveats.push('Collaborator prominence is inferred from OpenAlex profiles, not from a manual seniority label.');
  caveats.push('Coauthor identity labels appear only when an external source exposes explicit career-stage metadata; otherwise the label stays unverified.');

  return {
    metrics: {
      repeatCollaboration,
      seniorCollaboratorSignal,
      recentCollaboration,
      collaborationBreadth,
      topPartnerConcentration,
    },
    histogram,
    topCollaborators: frequentCollaboratorRows,
    notableCollaborators,
    highlights: highlights.slice(0, 4),
    caveats,
  };
}
