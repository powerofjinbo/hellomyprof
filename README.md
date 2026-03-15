# Professor Research Evidence Dashboard

An English-language web app for objective professor due diligence using public academic metadata.

The app is designed to answer a practical question:

What does the public research record actually show about this professor?

It combines:

- evidence-backed publication signals from OpenAlex
- author disambiguation and merged-profile handling for split OpenAlex identities
- multi-affiliation-aware institution matching so overlapping current and historical affiliations can be considered during identity resolution
- Google Scholar cross-checks when a configured Scholar proxy is available, with explicit `matched / blocked / unavailable` status boundaries
- official source discovery using ORCID, INSPIRE-HEP, DBLP, and verified institutional pages
- supplemental public-web source checks for Rate My Professors, ResearchGate, and Zotero, kept outside the core research-score path
- multidimensional scoring across influence, paper quality, output volume, publication cadence, field fit, and collaboration structure
- explicit coauthor identity evidence labels only when an external source exposes a current or latest-stage junior/student signal
- dynamic histograms for a single professor profile
- side-by-side comparison across multiple professors
- explicit source-boundary and caveat sections where metadata is not enough

## Why both GitHub and a live website

This project works best as both:

- `GitHub` for code, methodology, transparency, and reproducibility
- `Live website` for actual usage and a clean product demo

The recommended public setup is:

1. keep the source code in a public GitHub repo
2. deploy the site on Vercel or Netlify
3. link the deployed demo from the GitHub README
4. keep the scoring methodology and limitations documented in the repo

## Core product behavior

The app lets a user:

1. search for a professor by name, research area, and institution hint
2. merge split OpenAlex identities when the same professor appears under multiple close variants
3. generate a research evidence dashboard with publication, collaboration, and source-boundary evidence
4. add professors to a compare tray
5. view multi-professor histograms and objective dimension comparisons

## Scoring dimensions

The dashboard scores:

- `Influence`
- `Paper quality`
- `Output volume`
- `Publication cadence`
- `Field fit`
- `Repeat collaboration`
- `Senior-collab signal`
- `Network breadth`

Important limitation:

Student status and advising quality cannot be inferred safely from publication metadata alone. The app therefore labels coauthors as `explicit student` or `junior` only when an external record exposes that career stage clearly; otherwise the label remains `unverified`.

## Responsible usage

This project should be framed as a decision-support tool, not a definitive public ranking system.

Recommended public posture:

- generate reports on demand instead of publishing a static leaderboard of all professors
- show sources and caveats near the scores
- avoid absolute or defamatory language
- make clear which claims are data-backed and which remain outside the verified source boundary

## Local run

The enhanced version now uses a local Node server for:

- static file serving
- OpenAlex API proxying
- author identity merging
- Google Scholar proxy lookups when configured
- collaborator identity enrichment
- verified-source boundary discovery

Run:

```bash
cd /Users/powerofjinbo/Documents/New\ project
npm start
```

Then open:

- `http://localhost:4173/`

### Optional environment variables

- `SEARCHAPI_API_KEY` or `GOOGLE_SCHOLAR_SEARCHAPI_KEY`
  Enables structured Google Scholar profile lookup. Without one of these, the app still attempts a direct Scholar request and reports whether Google blocked the lookup from the current environment.

## Testing

Run:

```bash
cd /Users/powerofjinbo/Documents/New\ project
node --test
```

## Files

- `server.mjs` - local HTTP server, API routes, and static file serving
- `index.html` - app shell
- `src/app.css` - visual design and dashboard styles
- `src/app.mjs` - API-driven rendering and comparison UI
- `src/prof-evaluator.mjs` - scoring model, evidence summary, and comparison helpers
- `src/author-merge.mjs` - conservative merged-profile logic for split OpenAlex identities
- `src/supplemental-sources.mjs` - supplemental public-web source checks for Rate My Professors, ResearchGate, and Zotero
- `src/google-scholar.mjs` - Google Scholar enrichment, provider handling, and direct-access boundary reporting
- `src/collaboration-insights.mjs` - coauthor-network analysis
- `src/inspire-evidence.mjs` - explicit collaborator identity evidence via INSPIRE-HEP
- `src/web-enrichment.mjs` - verified institutional-source discovery and page extraction
- `tests/prof-evaluator.test.mjs` - evaluator tests
- `tests/author-merge.test.mjs` - author merge tests
- `tests/google-scholar.test.mjs` - Google Scholar enrichment tests
- `tests/supplemental-sources.test.mjs` - supplemental public-web source tests
- `tests/collaboration-insights.test.mjs` - collaboration evidence tests
- `tests/web-enrichment.test.mjs` - website enrichment parsing tests

## Deployment notes

### GitHub Pages

Only appropriate for the older client-only version.

### Vercel or Netlify

Better if you later add:

- response caching
- server-side caching
- richer comparison datasets
- usage analytics or saved reports

The current architecture already expects a server process, so Vercel, Netlify Functions, or a small Node host is now the right deployment direction.

## Next product upgrades

- improve merged-author precision with more institution-aware heuristics
- add more structured external sources beyond INSPIRE for non-HEP fields
- cache professor snapshots server-side for faster comparisons
- add exportable report links
- add query-consistent benchmark sets inside a single department or field
