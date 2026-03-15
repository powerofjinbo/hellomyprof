const USER_AGENT = 'Professor Research Evidence Dashboard/0.2 (mailto:research-dashboard@example.com)';

function normalizeDoi(doi) {
  if (!doi) return null;
  const raw = String(doi).trim();
  if (raw.startsWith('https://doi.org/')) return raw.replace('https://doi.org/', '');
  if (raw.startsWith('http://doi.org/')) return raw.replace('http://doi.org/', '');
  if (raw.startsWith('10.')) return raw;
  return null;
}

export async function lookupCrossrefWork(doi, fetchImpl = fetch) {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) return null;

  const url = `https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return null;

  const payload = await response.json();
  const work = payload?.message;
  if (!work) return null;

  return {
    doi: normalizedDoi,
    title: Array.isArray(work.title) ? work.title[0] : work.title || null,
    journal: work['container-title']?.[0] || null,
    publisher: work.publisher || null,
    type: work.type || null,
    referencesCount: work['references-count'] || 0,
    citedByCount: work['is-referenced-by-count'] || 0,
    license: work.license?.[0]?.URL || null,
    subjects: (work.subject || []).slice(0, 5),
    fundingInfo: (work.funder || []).slice(0, 3).map((f) => ({
      name: f.name,
      award: f.award?.[0] || null,
    })),
  };
}

export async function enrichTopWorksWithCrossref(topWorks, fetchImpl = fetch) {
  const results = await Promise.allSettled(
    topWorks.slice(0, 5).map(async (work) => {
      const doi = normalizeDoi(work.link);
      if (!doi) return null;
      return lookupCrossrefWork(work.link, fetchImpl);
    }),
  );

  return topWorks.map((work, index) => {
    if (index >= 5) return work;
    const crossref = results[index]?.status === 'fulfilled' ? results[index].value : null;
    if (!crossref) return work;
    return {
      ...work,
      crossref: {
        journal: crossref.journal,
        publisher: crossref.publisher,
        referencesCount: crossref.referencesCount,
        subjects: crossref.subjects,
        fundingInfo: crossref.fundingInfo,
      },
    };
  });
}
