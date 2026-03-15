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
    audienceLevel: String(formData.get('audienceLevel') || 'all'),
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

async function fetchReport(authorId, query) {
  const data = await postJson('/api/report', { authorId, query });
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

      return `
        <article class="candidate-card${active ? ' active' : ''}">
          <div class="candidate-main">
            <div>
              <h3>${escapeHtml(author.display_name)}</h3>
              <p class="candidate-meta">${escapeHtml(institution)}</p>
            </div>
            <div class="candidate-score">Match ${author.matchScore}/100</div>
          </div>
          <p class="topic-row">${escapeHtml(topic)} · ${formatCompactNumber(author.cited_by_count || 0)} citations · ${author.works_count || 0} works</p>
          <div class="candidate-actions">
            <span class="candidate-meta">H-index ${author.summary_stats?.h_index || 0}</span>
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
    confidenceLabel,
    metrics,
    strengths,
    risks,
    timeline,
    topWorks,
    summaryText,
    scoreProfile,
    webSignals,
    collaborationInsights,
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
            </li>
          `,
        )
        .join('')
    : '<li>No recent work sample could be assembled from the current metadata response.</li>';

  reportPanel.innerHTML = `
    <div class="report-topline">
      <div>
        <p class="report-kicker">Evaluation report</p>
        <h2 class="report-title">${escapeHtml(author.display_name)}</h2>
        <div class="report-meta">
          <p>${escapeHtml(institution)}</p>
          <p>Primary topic: ${escapeHtml(primaryTopic)}</p>
          <p>Sample size: ${metrics.sampleSize} recent works</p>
          <p>Context: ${escapeHtml(queryContextLabel(state.report))}</p>
        </div>
      </div>
      <div class="report-actions">
        <div class="score-pill">Overall evidence score · ${overallScore}/100</div>
        <div class="confidence-pill">Evidence confidence · ${confidenceScore}/100</div>
        <button id="copy-summary" class="copy-button" type="button">Copy summary</button>
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
      ${metricCard('Evidence coverage', metrics.evidenceCoverage, 'Breadth of verified evidence across people pages, lab pages, publications, and opportunity signals')}
      ${metricCard('Verification confidence', metrics.verificationConfidence, 'How much of the website layer is grounded in verified institutional pages rather than supporting links')}
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

    <section class="insights-grid">
      <div class="subpanel">
        <h3>Data-backed observations</h3>
        <ul class="insight-list">
          ${strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
      <div class="subpanel">
        <h3>Caveats and data limits</h3>
        <ul class="insight-list">
          ${risks.length ? risks.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>No major automatic red flags surfaced in the current sample, but mentor fit still needs direct validation.</li>'}
        </ul>
      </div>
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
        <div class="website-evidence-stack">
          ${
            collaborationInsights?.topCollaborators?.length
              ? collaborationInsights.topCollaborators
                  .map(
                    (person) => `
                      <article class="website-evidence-card">
                        <div class="website-evidence-topline">
                          <strong>${escapeHtml(person.name)}</strong>
                          <span class="score-pill score-pill-subtle">${escapeHtml(person.prominenceTier)}</span>
                        </div>
                        <p class="candidate-meta">${escapeHtml(person.institution)} · ${person.workCount} shared paper${person.workCount === 1 ? '' : 's'} · recent ${person.recentWorkCount} · last collaboration ${person.lastYear}</p>
                        <ul class="manual-checks">
                          <li>${person.hIndex != null ? `H-index ${person.hIndex}` : 'H-index unavailable'}${person.citations != null ? ` · ${formatCompactNumber(person.citations)} citations` : ''}</li>
                          ${person.sampleTitles?.map((title) => `<li>${escapeHtml(title)}</li>`).join('') || ''}
                        </ul>
                      </article>
                    `,
                  )
                  .join('')
              : '<p class="trajectory-footnote">No frequent collaborators were extracted from the current sample.</p>'
          }
        </div>
        ${
          collaborationInsights?.notableCollaborators?.length
            ? `
              <p class="candidate-meta">Notable collaborators in the sampled network</p>
              <ul class="manual-checks">
                ${collaborationInsights.notableCollaborators
                  .map(
                    (person) => `
                      <li>${escapeHtml(person.name)} · ${escapeHtml(person.prominenceTier)}${person.hIndex != null ? ` · H-index ${person.hIndex}` : ''} · ${person.workCount} shared paper${person.workCount === 1 ? '' : 's'}</li>
                    `,
                  )
                  .join('')}
              </ul>
            `
            : ''
        }
      </div>
    </section>

    <section class="evidence-grid">
      <div class="subpanel">
        <h3>Evidence coverage histogram</h3>
        <p class="candidate-meta">This chart uses only verified institution-domain pages. Supporting pages are excluded from these bars.</p>
        ${
          webSignals?.evidenceHistogram?.length
            ? renderProfileHistogram(webSignals.evidenceHistogram, 'single')
            : '<p class="trajectory-footnote">No verified website histogram could be built for this profile.</p>'
        }
      </div>
      <div class="subpanel">
        <h3>Verified facts</h3>
        <ul class="manual-checks">
          ${
            webSignals?.verifiedFacts?.length
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
              : '<li>No verified institution-domain fact could be extracted automatically for this profile.</li>'
          }
        </ul>
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
        <h3>Verified website evidence</h3>
        <ul class="manual-checks">
          ${
            webSignals?.highlights?.length
              ? webSignals.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
              : '<li>No verified institution-domain professor or lab page was recovered automatically for this search context.</li>'
          }
        </ul>
        <ul class="manual-checks">
          ${
            webSignals?.verifiedSources?.length
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
              : '<li>No verified institution-domain source is attached to this report yet.</li>'
          }
        </ul>
        ${
          webSignals?.supportingSources?.length
            ? `
              <p class="candidate-meta">Supporting links found but excluded from core scoring:</p>
              <ul class="manual-checks">
                ${webSignals.supportingSources
                  .map(
                    (item) => `
                      <li>
                        <a class="report-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}</a>
                        <span class="candidate-meta"> · ${escapeHtml(item.source)} · supporting only</span>
                      </li>
                    `,
                  )
                  .join('')}
              </ul>
            `
            : ''
        }
      </div>
      <div class="subpanel">
        <h3>Verified page snippets</h3>
        <div class="website-evidence-stack">
          ${
            webSignals?.verifiedPages?.length
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
              : '<p class="trajectory-footnote">Website enrichment did not produce verified page-level evidence for this profile.</p>'
          }
        </div>
      </div>
    </section>

    <section class="evidence-grid">
      <div class="subpanel">
        <h3>Source boundaries</h3>
        <ul class="manual-checks">
          ${collaborationInsights?.caveats?.length ? collaborationInsights.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : ''}
          ${webSignals?.caveats?.length ? webSignals.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : ''}
          ${webSignals?.inferenceBoundaries?.length ? webSignals.inferenceBoundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : ''}
        </ul>
      </div>
      <div class="subpanel">
        <h3>Sources</h3>
        <ul class="manual-checks">
          <li><a class="report-link" href="${escapeHtml(author.id)}" target="_blank" rel="noreferrer">OpenAlex author profile</a></li>
          ${author.ids?.orcid ? `<li><a class="report-link" href="${escapeHtml(author.ids.orcid)}" target="_blank" rel="noreferrer">ORCID record</a></li>` : ''}
          ${webSignals?.verifiedSources?.length ? webSignals.verifiedSources.map((item) => `<li><a class="report-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}</a></li>`).join('') : ''}
          <li>This report prioritizes publication metadata and coauthor structure over website roster counts.</li>
          <li>For fair comparison, keep the research field consistent across professors.</li>
        </ul>
      </div>
    </section>

    <div class="report-footer">
      <p>${escapeHtml(summaryText)}</p>
    </div>
  `;

  reportPanel.classList.remove('hidden');

  document.getElementById('copy-summary')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      status('Copied a concise evaluation summary to the clipboard.', 'success');
    } catch {
      status('Clipboard access failed in this browser context. You can still copy the footer summary manually.', 'error');
    }
  });

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
      </div>
    </div>
    <section class="overview-grid">
      ${Array.from({ length: 6 }, () => '<article class="metric-card skeleton"></article>').join('')}
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
              <p class="candidate-meta">Field fit ${item.fieldFit}/100 · Repeat collaboration ${item.repeatCollaboration}/100 · Evidence coverage ${item.evidenceCoverage}/100</p>
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
    authorId: author.id,
    researchField: state.query?.researchField || '',
    audienceLevel: state.query?.audienceLevel || 'all',
    institutionName: state.query?.institutionName || '',
  });
  state.selectedAuthorId = author.id;
  renderMatchPanel();
  renderLoading(`Evaluating ${author.display_name}...`);
  status(`Loading publication, collaboration, and verified-evidence signals for ${author.display_name}...`);

  try {
    let cached = state.reportCache.get(cacheKey);
    if (!cached) {
      cached = await fetchReport(author.id, state.query);
      state.reportCache.set(cacheKey, cached);
    }

    if (requestId !== state.requestId) {
      return;
    }

    state.report = cached;
    renderReport();
    renderMatchPanel();
    renderComparisonPanel();
    status(`Evaluation generated for ${author.display_name}. Add it to the compare tray if you want side-by-side histograms.`, 'success');
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
  status('Searching OpenAlex author profiles and preparing evidence extraction...');

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
