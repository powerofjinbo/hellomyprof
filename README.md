# Professor Research Opportunity Evaluator

An English-language web app that helps students evaluate professor research opportunities across undergraduate, master's, and PhD pathways using public academic metadata.

The app is designed to answer a practical question:

Which professor looks strongest for my academic trajectory, and why?

It combines:

- evidence-backed publication signals from OpenAlex
- official professor and lab website discovery using DBLP, ROR, and public researcher pages
- multidimensional scoring across influence, paper quality, output volume, update frequency, field fit, and mentorship proxy
- website-derived scoring across website visibility, website freshness, and student opportunity language
- dynamic histograms for a single professor profile
- side-by-side comparison across multiple professors
- explicit caveats and manual verification steps where metadata is not enough

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
2. pick the correct OpenAlex profile when name collisions exist
3. generate an evaluation report with evidence and caveats
4. add professors to a compare tray
5. view multi-professor histograms and track-by-track comparisons

## Scoring dimensions

The evaluator scores:

- `Influence`
- `Paper quality`
- `Output volume`
- `Update frequency`
- `Field fit`
- `Mentorship proxy`
- `Website visibility`
- `Website freshness`
- `Student opportunity`
- `Undergraduate fit`
- `Master's fit`
- `PhD fit`

Important limitation:

Undergraduate coauthorship and advising behavior cannot be directly verified from OpenAlex metadata alone. The app therefore treats undergraduate opportunity as a proxy signal and always includes manual verification prompts.

## Responsible usage

This project should be framed as a decision-support tool, not a definitive public ranking system.

Recommended public posture:

- generate reports on demand instead of publishing a static leaderboard of all professors
- show sources and caveats near the scores
- avoid absolute or defamatory language
- make clear which claims are data-backed and which are proxy-based

## Local run

The enhanced version now uses a local Node server for:

- static file serving
- OpenAlex API proxying
- official-site discovery
- professor and lab page enrichment

Run:

```bash
cd /Users/powerofjinbo/Documents/New\ project
npm start
```

Then open:

- `http://localhost:4173/`

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
- `src/web-enrichment.mjs` - official website discovery, page fetching, and website-signal extraction
- `tests/prof-evaluator.test.mjs` - evaluator tests
- `tests/web-enrichment.test.mjs` - website enrichment parsing tests

## Deployment notes

### GitHub Pages

Only appropriate for the older client-only version.

### Vercel or Netlify

Better if you later add:

- professor website scraping
- server-side caching
- LLM summarization
- richer comparison datasets
- usage analytics or saved reports

The current architecture already expects a server process, so Vercel, Netlify Functions, or a small Node host is now the right deployment direction.

## Next product upgrades

- add lab website ingestion beyond OpenAlex
- pull student roster or publication-page evidence when available
- cache professor snapshots server-side for faster comparisons
- add exportable report links
- add query-consistent benchmark sets inside a single department or field
