import {
  compareProfessorReports,
  formatCompactNumber,
  pickInstitution,
} from './prof-evaluator.mjs';

const form = document.getElementById('search-form');
const searchButton = document.getElementById('search-button');
const statusBanner = document.getElementById('status-banner');
const matchPanel = document.getElementById('match-panel');
const reportPanel = document.getElementById('report-panel');
const comparisonPanel = document.getElementById('comparison-panel');
const exampleButtons = document.querySelectorAll('.example-chip');

const MAX_COMPARE = 4;
const COMPARE_COLORS = ['#9f3d21', '#1d5f5d', '#996b1b', '#7b5689'];

const state = {
  query: null,
  matches: [],
  selectedAuthorId: null,
  report: null,
  requestId: 0,
  reportCache: new Map(),
  comparisonReports: [],
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) {
    return parts.join(' ');
  }
  return `${parts[0]} ${parts.at(-1)}`;
}

function status(message, tone = '') {
  statusBanner.textContent = message;
  if (tone) {
    statusBanner.dataset.tone = tone;
  } else {
    delete statusBanner.dataset.tone;
  }
}

function readQuery() {
  const formData = new FormData(form);
  return {
    professorName: String(formData.get('professorName') || '').trim(),
    researchField: String(formData.get('researchField') || '').trim(),
    institutionName: String(formData.get('institutionName') || '').trim(),
    apiEmail: String(formData.get('apiEmail') || '').trim(),
    apiKey: String(formData.get('apiKey') || '').trim(),
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((data) => data.error || `Request failed with status ${response.status}.`)
      .catch(() => `Request failed with status ${response.status}.`);
    throw new Error(message);
  }

  return response.json();
}

async function searchAuthors(query) {
  const data = await postJson('/api/search', query);
  return data.matches || [];
}

async function fetchReport(author, query) {
  const payload = {
    query,
    authorId: author.id,
  };
  if (author.mergedAuthorIds?.length) {
    payload.authorIds = author.mergedAuthorIds;
  }
  const data = await postJson('/api/report', payload);
  return data.report;
}

function isCompared(authorId) {
  return state.comparisonReports.some((report) => report.author.id === authorId);
}

function queryContextLabel(report) {
  const researchField = report.queryContext?.researchField || 'Broad search';
  return researchField;
}

function getComparedIndex(authorId) {
  return state.comparisonReports.findIndex((report) => report.author.id === authorId);
}

function metricCard(title, score, subtitle) {
  return `
    <article class="metric-card">
      <h3 class="metric-title">${escapeHtml(title)}</h3>
      <p class="score-number">${score}</p>
      <p class="metric-subtitle">${escapeHtml(subtitle)}</p>
    </article>
  `;
}

function renderProfileHistogram(entries, variant = 'single') {
  return `
    <div class="profile-histogram profile-histogram-${variant}">
      ${entries
        .map(
          (entry) => `
            <div class="profile-column">
              <div class="profile-value">${entry.value}</div>
              <div class="profile-bar-shell">
                <div class="profile-bar" style="--bar-height:${entry.value / 100};"></div>
              </div>
              <div class="profile-label">${escapeHtml(entry.label)}</div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderMatchPanel() {
  if (!state.matches.length) {
    matchPanel.classList.add('hidden');
    return;
  }

  const cards = state.matches
    .map((author) => {
      const active = author.id === state.selectedAuthorId;
      const institution = pickInstitution(author, state.query?.institutionName || '');
      const topic = author.topics?.[0]?.display_name || 'Topic unavailable';
      const isMerged = author.mergedProfileCount > 1;
      const topicRow = isMerged
        ? `${topic} · merged candidate · ${author.mergedProfileCount} source profiles`
        : `${topic} · ${formatCompactNumber(author.cited_by_count || 0)} citations · ${author.works_count || 0} works`;
      const metaLabel = isMerged
        ? 'Citation / work / H-index metrics are recomputed after loading the merged report'
        : `H-index ${author.summary_stats?.h_index || 0}`;

      return `
        <article class="candidate-card${active ? ' active' : ''}">
          <div class="candidate-main">
            <div>
              <h3>${escapeHtml(author.display_name)}</h3>
              <p class="candidate-meta">${escapeHtml(institution)}</p>
              ${
                isMerged
                  ? `<p class="candidate-meta">Merged ${author.mergedProfileCount} OpenAlex profiles for author disambiguation.</p>`
                  : ''
              }
            </div>
            <div class="candidate-score">Match ${author.matchScore}/100</div>
          </div>
          <p class="topic-row">${escapeHtml(topicRow)}</p>
          <div class="candidate-actions">
            <span class="candidate-meta">${escapeHtml(metaLabel)}</span>
            <button class="match-button" type="button" data-author-id="${escapeHtml(author.id)}">
              ${active ? 'Viewing report' : 'Use this profile'}
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  matchPanel.innerHTML = `
    <div class="candidate-header">
      <div>
        <p class="eyebrow">Profiles</p>
        <h2>Candidate professor matches</h2>
      </div>
      <p class="candidate-meta">Switch profiles if OpenAlex returns multiple people with similar names.</p>
    </div>
    <div class="candidate-list">${cards}</div>
  `;
  matchPanel.classList.remove('hidden');

  for (const button of matchPanel.querySelectorAll('.match-button')) {
    button.addEventListener('click', async () => {
      const targetId = button.dataset.authorId;
      const author = state.matches.find((item) => item.id === targetId);
      if (!author || targetId === state.selectedAuthorId) {
        return;
      }
      await loadAuthor(author);
    });
  }
}

function renderReport() {
  if (!state.report) {
    reportPanel.classList.add('hidden');
    reportPanel.innerHTML = '';
    return;
  }

  const {
    author,
    institution,
    primaryTopic,
    overallScore,
    confidenceScore,
    metrics,
    timeline,
    topWorks,
    summaryText,
    scoreProfile,
    webSignals,
    collaborationInsights,
    externalProfiles,
  } = state.report;

  const inCompare = isCompared(author.id);
  const timelineBars = timeline
    .map(
      (item) => `
        <div class="trajectory-bar">
          <div class="trajectory-count">${item.count}</div>
          <div class="trajectory-fill" style="--bar-height:${item.height};"></div>
          <div class="trajectory-year">${item.year}</div>
        </div>
      `,
    )
    .join('');

  const topWorksHtml = topWorks.length
    ? topWorks
        .map(
          (work) => `
            <li>
              <a class="paper-link" href="${escapeHtml(work.link)}" target="_blank" rel="noreferrer">${escapeHtml(work.title)}</a>
              <div class="paper-meta">${work.year} · ${escapeHtml(work.venue)} · ${work.citations} citations · percentile ${work.percentile}${work.topTen ? ' · top 10%' : ''}</div>
              ${work.crossref ? `<div class="paper-meta">${work.crossref.journal ? `${escapeHtml(work.crossref.journal)}` : ''}${work.crossref.subjects?.length ? ` · ${work.crossref.subjects.slice(0, 2).map((s) => escapeHtml(s)).join(', ')}` : ''}${work.crossref.fundingInfo?.length ? ` · Funded by ${work.crossref.fundingInfo.map((f) => escapeHtml(f.name)).join(', ')}` : ''}</div>` : ''}
            </li>
          `,
        )
        .join('')
    : '<li>No recent work sample could be assembled from the current metadata response.</li>';
  const openAlexSourceItems = (author.mergedAuthorIds?.length ? author.mergedAuthorIds : [author.id])
    .map(
      (sourceId, index) => `
        <li>
          <a class="report-link" href="${escapeHtml(sourceId)}" target="_blank" rel="noreferrer">
            OpenAlex author profile${author.mergedAuthorIds?.length > 1 ? ` ${index + 1}` : ''}
          </a>
        </li>
      `,
    )
    .join('');
  const verifiedFactsHtml = webSignals?.verifiedFacts?.length
    ? webSignals.verifiedFacts
        .map(
          (fact) => `
            <li>
              <strong>${escapeHtml(fact.label)}:</strong> ${escapeHtml(fact.value)}
              ${fact.sourceUrl ? ` <a class="report-link" href="${escapeHtml(fact.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ''}
              ${fact.detail ? `<div class="fact-detail">${escapeHtml(fact.detail)}</div>` : ''}
            </li>
          `,
        )
        .join('')
    : '<li>No verified institution-domain fact could be extracted automatically for this profile.</li>';
  const collaboratorCardsHtml = collaborationInsights?.topCollaborators?.length
    ? collaborationInsights.topCollaborators
        .map((person) => {
          const identityLabel = person.identityEvidence?.label || 'unverified';
          const identityEvidenceText =
            person.identityEvidence?.evidenceText || 'No explicit student-stage or junior-stage identity evidence was recovered.';
          const identitySource = person.identityEvidence?.sourceUrl
            ? `<a class="report-link" href="${escapeHtml(person.identityEvidence.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(person.identityEvidence.source || 'Source')}</a>`
            : '';
          return `
            <article class="website-evidence-card">
              <div class="website-evidence-topline">
                <strong>${escapeHtml(person.name)}</strong>
                <span class="score-pill score-pill-subtle">${escapeHtml(person.prominenceTier)}</span>
              </div>
              <p class="candidate-meta">${escapeHtml(person.institution)} · ${person.workCount} shared paper${person.workCount === 1 ? '' : 's'} · recent ${person.recentWorkCount} · last collaboration ${person.lastYear}</p>
              <ul class="manual-checks">
                <li>${person.hIndex != null ? `H-index ${person.hIndex}` : 'H-index unavailable'}${person.citations != null ? ` · ${formatCompactNumber(person.citations)} citations` : ''}</li>
                <li>Identity evidence: ${escapeHtml(identityLabel)}${identitySource ? ` · ${identitySource}` : ''}</li>
                <li>${escapeHtml(identityEvidenceText)}</li>
                ${person.sampleTitles?.map((title) => `<li>${escapeHtml(title)}</li>`).join('') || ''}
              </ul>
            </article>
          `;
        })
        .join('')
    : '<p class="trajectory-footnote">No frequent collaborators were extracted from the current sample.</p>';
  const verifiedSourceList = webSignals?.verifiedSources?.length
    ? webSignals.verifiedSources
        .map(
          (item) => `
            <li>
              <a class="report-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}</a>
              <span class="candidate-meta"> · ${escapeHtml(item.source)} · verified</span>
            </li>
          `,
        )
        .join('')
    : '<li>No verified institution-domain source is attached to this report yet.</li>';
  const supportingSourceList = webSignals?.supportingSources?.length
    ? webSignals.supportingSources
        .map(
          (item) => `
            <li>
              <a class="report-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}</a>
              <span class="candidate-meta"> · ${escapeHtml(item.source)} · excluded from core metrics</span>
            </li>
          `,
        )
        .join('')
    : '';
  const verifiedSnippetCards = webSignals?.verifiedPages?.length
    ? webSignals.verifiedPages
        .map(
          (page) => `
            <article class="website-evidence-card">
              <div class="website-evidence-topline">
                <a class="paper-link" href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.title)}</a>
                <span class="score-pill score-pill-subtle">${escapeHtml(page.kind)}</span>
              </div>
              <p class="candidate-meta">${escapeHtml(page.signalSummary)}${page.publishedTime ? ` · ${escapeHtml(page.publishedTime)}` : ''}</p>
              <ul class="manual-checks">
                ${
                  page.snippets?.length
                    ? page.snippets.map((snippet) => `<li>${escapeHtml(snippet)}</li>`).join('')
                    : '<li>No high-signal snippet was extracted from this page.</li>'
                }
              </ul>
            </article>
          `,
        )
        .join('')
    : '<p class="trajectory-footnote">Website enrichment did not produce verified page-level evidence for this profile.</p>';
  const googleScholar = externalProfiles?.googleScholar || null;
  const googleScholarStatusLabel =
    googleScholar?.status === 'matched'
      ? `matched via ${googleScholar.provider}`
      : googleScholar?.status === 'blocked'
        ? `attempted via ${googleScholar.provider} · blocked`
        : googleScholar?.status === 'error'
          ? `attempted via ${googleScholar.provider} · error`
          : googleScholar?.status === 'unavailable'
            ? `attempted via ${googleScholar?.provider || 'direct'} · no confident profile`
            : 'not queried';
  const metricCrossCheckItems = [
    `<li>OpenAlex · H-index ${metrics.hIndex} · ${metrics.citationsLabel} citations · ${metrics.worksCount} works</li>`,
    externalProfiles?.semanticScholar
      ? `<li>Semantic Scholar · ${externalProfiles.semanticScholar.hIndex != null ? `H-index ${externalProfiles.semanticScholar.hIndex}` : 'H-index unavailable'}${externalProfiles.semanticScholar.citationCount != null ? ` · ${formatCompactNumber(externalProfiles.semanticScholar.citationCount)} citations` : ''}${externalProfiles.semanticScholar.paperCount != null ? ` · ${formatCompactNumber(externalProfiles.semanticScholar.paperCount)} papers` : ''}</li>`
      : '<li>Semantic Scholar · no matched profile returned</li>',
    googleScholar
      ? `<li>Google Scholar · ${googleScholar.status === 'matched' ? `${googleScholar.hIndex != null ? `H-index ${googleScholar.hIndex}` : 'H-index unavailable'}${googleScholar.citationCount != null ? ` · ${formatCompactNumber(googleScholar.citationCount)} citations` : ''}${googleScholar.affiliation ? ` · ${escapeHtml(googleScholar.affiliation)}` : ''}` : escapeHtml(googleScholarStatusLabel)}</li>`
      : '<li>Google Scholar · no lookup attempted</li>',
  ].join('');
  const googleScholarSourceItem = googleScholar
    ? `
        <li>
          <a class="report-link" href="${escapeHtml(googleScholar.profileUrl || googleScholar.authorSearchUrl || googleScholar.searchUrl)}" target="_blank" rel="noreferrer">
            Google Scholar${googleScholar.profileUrl ? ' profile' : ' search'}
          </a>
          <span class="candidate-meta">
            · ${escapeHtml(googleScholarStatusLabel)}
            ${googleScholar.matchConfidence ? ` · confidence ${googleScholar.matchConfidence}/100` : ''}
          </span>
        </li>
      `
    : '';
  const googleScholarEvidence = googleScholar
    ? `
        <ul class="manual-checks">
          <li>${escapeHtml(googleScholar.note || 'No Google Scholar boundary note was returned.')}</li>
          ${
            googleScholar.verifiedEmail
              ? `<li>Scholar contact domain: ${escapeHtml(googleScholar.verifiedEmail)}</li>`
              : ''
          }
          ${
            googleScholar.interests?.length
              ? `<li>Scholar interests: ${escapeHtml(googleScholar.interests.slice(0, 5).join(', '))}</li>`
              : ''
          }
          ${
            googleScholar.coAuthors?.length
              ? `<li>Scholar coauthor sample: ${googleScholar.coAuthors.slice(0, 4).map((entry) => escapeHtml(entry.name)).join(', ')}</li>`
              : ''
          }
        </ul>
      `
    : '<ul class="manual-checks"><li>Google Scholar did not return a structured profile payload for this report.</li></ul>';

  reportPanel.innerHTML = `
    <div class="report-topline">
      <div>
        <p class="report-kicker">Research evidence dashboard</p>
        <h2 class="report-title">${escapeHtml(author.display_name)}</h2>
        <div class="report-meta">
          <p>${escapeHtml(institution)}</p>
          <p>Primary topic: ${escapeHtml(primaryTopic)}</p>
          <p>Sample size: ${metrics.sampleSize} recent works</p>
          <p>Context: ${escapeHtml(queryContextLabel(state.report))}</p>
          ${author.mergedProfileCount > 1 ? `<p>Identity resolution: merged ${author.mergedProfileCount} OpenAlex profiles</p>` : ''}
        </div>
      </div>
      <div class="report-actions">
        <div class="score-pill">Overall evidence score · ${overallScore}/100</div>
        <div class="confidence-pill">Source confidence · ${confidenceScore}/100</div>
        <button id="compare-snapshot" class="copy-button" type="button">${inCompare ? 'Update compare snapshot' : 'Add to compare'}</button>
      </div>
    </div>

    <section class="overview-grid">
      ${metricCard('Influence', metrics.influence, `H-index ${metrics.hIndex}, ${metrics.citationsLabel} citations, ${metrics.worksCount} total works`)}
      ${metricCard('Paper quality', metrics.paperQuality, `${metrics.topTenLabel} of sampled papers land in the top 10% normalized citation band`)}
      ${metricCard('Output volume', metrics.outputVolume, `${metrics.worksCount} lifetime works with recent production factored in`)}
      ${metricCard('Publication cadence', metrics.momentum, `Latest publication: ${metrics.latestPublicationLabel}`)}
      ${metricCard('Field fit', metrics.fieldFit, "Estimated overlap between your query and the professor's topic footprint")}
      ${metricCard('Repeat collaboration', metrics.repeatCollaboration, 'Measures how often the same coauthors recur across the sampled papers')}
      ${metricCard('Senior-collab signal', metrics.seniorCollaboratorSignal, 'Based on collaborator influence profiles in the sampled network')}
      ${metricCard('Network breadth', metrics.collaborationBreadth, 'Breadth of recurring coauthors in the recent sampled publication window')}
    </section>

    <section class="subpanel">
      <div class="subpanel-topline">
        <div>
          <h3>Dynamic score histogram</h3>
          <p class="candidate-meta">A single-view dimension profile for the current professor.</p>
        </div>
      </div>
      ${renderProfileHistogram(scoreProfile, 'single')}
    </section>

    <section class="evidence-grid">
      <div class="subpanel">
        <h3>Collaboration network histogram</h3>
        <p class="candidate-meta">Built from recent coauthorship metadata rather than lab roster counts.</p>
        ${
          collaborationInsights?.histogram?.length
            ? renderProfileHistogram(collaborationInsights.histogram, 'single')
            : '<p class="trajectory-footnote">No collaboration histogram could be built from the current work sample.</p>'
        }
      </div>
      <div class="subpanel">
        <h3>Frequent collaborators</h3>
        <div class="website-evidence-stack">${collaboratorCardsHtml}</div>
      </div>
    </section>

    <section class="evidence-grid">
      <div class="subpanel">
        <h3>Publication trajectory</h3>
        <div class="trajectory-bars">${timelineBars}</div>
        <p class="trajectory-footnote">Counts come from yearly author metadata and emphasize recent publishing momentum rather than lifetime totals.</p>
      </div>
      <div class="subpanel">
        <h3>Recent evidence papers</h3>
        <ol class="paper-list">${topWorksHtml}</ol>
      </div>
    </section>

    <section class="evidence-grid">
      <div class="subpanel">
        <h3>External metric cross-check</h3>
        <ul class="manual-checks">
          ${metricCrossCheckItems}
        </ul>
      </div>
      <div class="subpanel">
        <h3>Google Scholar boundary</h3>
        ${googleScholarEvidence}
      </div>
    </section>

    <section class="evidence-grid">
      <div class="subpanel">
        <h3>Verified source boundary</h3>
        <ul class="manual-checks">
          ${verifiedFactsHtml}
        </ul>
        <ul class="manual-checks">
          ${collaborationInsights?.caveats?.length ? collaborationInsights.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : ''}
          ${webSignals?.caveats?.length ? webSignals.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : ''}
          ${webSignals?.inferenceBoundaries?.length ? webSignals.inferenceBoundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : ''}
        </ul>
      </div>
      <div class="subpanel">
        <h3>Verified page snippets</h3>
        <div class="website-evidence-stack">${verifiedSnippetCards}</div>
      </div>
    </section>

    <section class="evidence-grid">
      <div class="subpanel">
        <h3>External records</h3>
        <div class="external-links-grid">
          ${openAlexSourceItems}
          ${externalProfiles?.orcidUrl ? `<li><a class="report-link" href="${escapeHtml(externalProfiles.orcidUrl)}" target="_blank" rel="noreferrer">ORCID record</a></li>` : (author.ids?.orcid ? `<li><a class="report-link" href="${escapeHtml(author.ids.orcid)}" target="_blank" rel="noreferrer">ORCID record</a></li>` : '')}
          ${externalProfiles?.inspire?.sourceUrl ? `<li><a class="report-link" href="${escapeHtml(externalProfiles.inspire.sourceUrl)}" target="_blank" rel="noreferrer">INSPIRE-HEP author record</a></li>` : ''}
          ${externalProfiles?.semanticScholar?.url ? `<li><a class="report-link" href="${escapeHtml(externalProfiles.semanticScholar.url)}" target="_blank" rel="noreferrer">Semantic Scholar profile</a> <span class="candidate-meta">· ${externalProfiles.semanticScholar.citationCount != null ? `${formatCompactNumber(externalProfiles.semanticScholar.citationCount)} citations` : 'profile found'}</span></li>` : ''}
          ${externalProfiles?.dblpProfileUrl ? `<li><a class="report-link" href="${escapeHtml(externalProfiles.dblpProfileUrl)}" target="_blank" rel="noreferrer">DBLP author page</a></li>` : ''}
          ${googleScholarSourceItem}
          ${externalProfiles?.scopusUrl ? `<li><a class="report-link" href="${escapeHtml(externalProfiles.scopusUrl)}" target="_blank" rel="noreferrer">Scopus author profile</a></li>` : ''}
          ${externalProfiles?.homepage ? `<li><a class="report-link" href="${escapeHtml(externalProfiles.homepage)}" target="_blank" rel="noreferrer">Author homepage</a> <span class="candidate-meta">· external</span></li>` : ''}
        </div>
        <ul class="manual-checks" style="margin-top: 14px;">
          ${verifiedSourceList}
        </ul>
      </div>
      <div class="subpanel">
        <h3>Excluded supporting links</h3>
        <ul class="manual-checks">
          ${supportingSourceList || '<li>No additional supporting links were recovered for this profile.</li>'}
        </ul>
      </div>
    </section>

    <div class="report-footer">
      <p>${escapeHtml(summaryText)}</p>
    </div>
  `;

  reportPanel.classList.remove('hidden');

  document.getElementById('compare-snapshot')?.addEventListener('click', () => {
    addCurrentReportToComparison();
  });
}

function renderLoading(message) {
  reportPanel.innerHTML = `
    <div class="report-topline">
      <div>
        <p class="report-kicker">Loading</p>
        <h2 class="report-title">${escapeHtml(message)}</h2>
        <div class="loading-steps">
          <p class="loading-step">Fetching OpenAlex publication data...</p>
          <p class="loading-step">Querying ORCID, INSPIRE-HEP, Semantic Scholar, Google Scholar...</p>
          <p class="loading-step">Analyzing collaboration network...</p>
          <p class="loading-step">Discovering verified institutional sources...</p>
        </div>
      </div>
    </div>
    <section class="overview-grid">
      ${Array.from({ length: 8 }, () => '<article class="metric-card skeleton"></article>').join('')}
    </section>
  `;
  reportPanel.classList.remove('hidden');
}

function renderComparisonDimensionCards(dimensions) {
  return dimensions
    .map((dimension) => {
      const scores = state.comparisonReports
        .map((report, index) => {
          const value = dimension.scores.find((entry) => entry.authorId === report.author.id)?.value ?? 0;
          return {
            value,
            label: shortName(report.author.display_name),
            color: COMPARE_COLORS[index % COMPARE_COLORS.length],
          };
        })
        .filter(Boolean);

      return `
        <article class="histogram-card">
          <div class="subpanel-topline">
            <div>
              <h3>${escapeHtml(dimension.label)}</h3>
              <p class="candidate-meta">Leader: ${escapeHtml(dimension.leader?.name || 'n/a')} · ${dimension.leader?.value ?? 0}/100</p>
            </div>
          </div>
          <div class="compare-histogram">
            ${scores
              .map(
                (score) => `
                  <div class="compare-column">
                    <div class="compare-value">${score.value}</div>
                    <div class="compare-bar-shell">
                      <div class="compare-bar" style="--bar-height:${score.value / 100}; --bar-color:${score.color};"></div>
                    </div>
                    <div class="compare-label">${escapeHtml(score.label)}</div>
                  </div>
                `,
              )
              .join('')}
          </div>
        </article>
      `;
    })
    .join('');
}

function renderComparisonPanel() {
  if (!state.comparisonReports.length) {
    comparisonPanel.classList.add('hidden');
    comparisonPanel.innerHTML = '';
    return;
  }

  const comparison = compareProfessorReports(state.comparisonReports);
  const coreDimensions = comparison.dimensions;
  const contextSet = new Set(
    state.comparisonReports.map(
      (report) => `${report.queryContext?.researchField || ''}`,
    ),
  );
  const mixedContext = contextSet.size > 1;

  comparisonPanel.innerHTML = `
    <div class="candidate-header">
      <div>
        <p class="eyebrow">Compare</p>
        <h2>Professor comparison dashboard</h2>
      </div>
      <div class="compare-actions">
        <button id="clear-comparison" class="copy-button" type="button">Clear compare tray</button>
      </div>
    </div>

    <div class="compare-roster">
      ${state.comparisonReports
        .map(
          (report, index) => `
            <article class="compare-pill">
              <span class="compare-swatch" style="--swatch:${COMPARE_COLORS[index % COMPARE_COLORS.length]};"></span>
              <div class="compare-pill-copy">
                <strong>${escapeHtml(report.author.display_name)}</strong>
                <span>${escapeHtml(report.institution)}</span>
                <span>${escapeHtml(queryContextLabel(report))}</span>
              </div>
              <button class="compare-remove" type="button" data-author-id="${escapeHtml(report.author.id)}">Remove</button>
            </article>
          `,
        )
        .join('')}
    </div>

    <div class="compare-note${mixedContext ? ' compare-note-warning' : ''}">
      ${
        mixedContext
          ? 'The compare tray currently mixes different research-field settings. Keep them aligned if you want a fair apples-to-apples comparison.'
          : 'Compare mode is most reliable when the research field stays consistent across searches.'
      }
    </div>

    <section class="compare-summary-grid">
      ${comparison.leaderboard
        .map(
          (item, index) => `
            <article class="compare-summary-card">
              <p class="compare-rank">#${index + 1}</p>
              <h3>${escapeHtml(item.name)}</h3>
              <p class="candidate-meta">${escapeHtml(item.institution)}</p>
              <div class="compare-score-row">
                <span class="score-pill">${item.overallScore}/100</span>
                <span class="confidence-pill">Evidence ${item.confidenceScore}/100</span>
              </div>
              <p class="candidate-meta">Field fit ${item.fieldFit}/100 · Publication cadence ${item.momentum}/100 · Repeat collaboration ${item.repeatCollaboration}/100 · Senior-collab ${item.seniorCollaboratorSignal}/100</p>
            </article>
          `,
        )
        .join('')}
    </section>

    <section class="subpanel">
      <div class="subpanel-topline">
        <div>
          <h3>Objective comparison histogram</h3>
          <p class="candidate-meta">Each panel compares a publication, collaboration, or evidence dimension.</p>
        </div>
      </div>
      <div class="histogram-grid">
        ${renderComparisonDimensionCards(coreDimensions)}
      </div>
    </section>
  `;

  comparisonPanel.classList.remove('hidden');

  document.getElementById('clear-comparison')?.addEventListener('click', () => {
    state.comparisonReports = [];
    renderComparisonPanel();
    status('Cleared the compare tray.', 'success');
  });

  for (const button of comparisonPanel.querySelectorAll('.compare-remove')) {
    button.addEventListener('click', () => {
      state.comparisonReports = state.comparisonReports.filter((report) => report.author.id !== button.dataset.authorId);
      renderComparisonPanel();
      renderReport();
      status('Removed that professor from the compare tray.', 'success');
    });
  }
}

function addCurrentReportToComparison() {
  if (!state.report) {
    return;
  }

  const existingIndex = getComparedIndex(state.report.author.id);
  if (existingIndex >= 0) {
    state.comparisonReports.splice(existingIndex, 1, state.report);
    renderComparisonPanel();
    renderReport();
    status(`Updated the compare snapshot for ${state.report.author.display_name}.`, 'success');
    return;
  }

  if (state.comparisonReports.length >= MAX_COMPARE) {
    state.comparisonReports.shift();
  }

  state.comparisonReports.push(state.report);
  renderComparisonPanel();
  renderReport();
  status(`Added ${state.report.author.display_name} to the compare tray. Search another professor to build a side-by-side view.`, 'success');
}

async function loadAuthor(author) {
  const requestId = ++state.requestId;
  const cacheKey = JSON.stringify({
    authorIds: author.mergedAuthorIds?.length ? author.mergedAuthorIds : [author.id],
    researchField: state.query?.researchField || '',
    institutionName: state.query?.institutionName || '',
  });
  state.selectedAuthorId = author.id;
  renderMatchPanel();
  renderLoading(`Evaluating ${author.display_name}...`);
  status(`Loading publication, coauthor, and verified-source evidence for ${author.display_name}...`);

  try {
    let cached = state.reportCache.get(cacheKey);
    if (!cached) {
      cached = await fetchReport(author, state.query);
      state.reportCache.set(cacheKey, cached);
    }

    if (requestId !== state.requestId) {
      return;
    }

    state.report = cached;
    renderReport();
    renderMatchPanel();
    renderComparisonPanel();
    status(`Research evidence dashboard generated for ${author.display_name}. Add it to compare if you want side-by-side histograms.`, 'success');
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }

    state.report = null;
    renderReport();
    status(error.message || 'Failed to build the evaluation report.', 'error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const query = readQuery();
  if (!query.professorName) {
    status('Enter a professor name before running the evaluation.', 'error');
    return;
  }

  state.query = query;
  state.matches = [];
  state.selectedAuthorId = null;
  state.report = null;
  searchButton.disabled = true;
  matchPanel.classList.add('hidden');
  renderLoading('Searching OpenAlex author profiles...');
  status('Searching OpenAlex author profiles and preparing research evidence extraction...');

  try {
    const matches = await searchAuthors(query);
    state.matches = matches;
    if (!matches.length) {
      reportPanel.classList.add('hidden');
      reportPanel.innerHTML = '';
      status('No author profiles matched that search. Try a fuller name or add an institution hint.', 'error');
      return;
    }

    renderMatchPanel();
    await loadAuthor(matches[0]);
  } catch (error) {
    reportPanel.classList.add('hidden');
    reportPanel.innerHTML = '';
    status(error.message || 'The author search failed.', 'error');
  } finally {
    searchButton.disabled = false;
  }
}

for (const button of exampleButtons) {
  button.addEventListener('click', () => {
    document.getElementById('professor-name').value = button.dataset.name || '';
    document.getElementById('research-field').value = button.dataset.field || '';
    document.getElementById('institution-name').value = button.dataset.institution || '';
  });
}

renderComparisonPanel();
form.addEventListener('submit', handleSubmit);
