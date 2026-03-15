import test from 'node:test';
import assert from 'node:assert/strict';

import { extractMarkdownLinks, parseDblpExternalUrls } from '../src/web-enrichment.mjs';

test('parseDblpExternalUrls keeps only external homepage-style URLs', () => {
  const xml = `
    <dblpperson>
      <person>
        <author>Ada Lovelace</author>
        <url>https://example.edu/~ada</url>
        <url>https://lab.example.edu/</url>
        <url>db/conf/example/example2025.html</url>
      </person>
    </dblpperson>
  `;

  const urls = parseDblpExternalUrls(xml);

  assert.deepEqual(urls, ['https://example.edu/~ada', 'https://lab.example.edu']);
});

test('extractMarkdownLinks returns markdown and bare URLs with page kinds', () => {
  const markdown = `
    [Publications](https://example.edu/publications)
    [Current Students](https://example.edu/people/students)
    Contact page: https://example.edu/join-us
  `;

  const links = extractMarkdownLinks(markdown);
  const urls = links.map((item) => item.url);

  assert.deepEqual(urls, [
    'https://example.edu/publications',
    'https://example.edu/people/students',
    'https://example.edu/join-us',
  ]);
  assert.equal(links[0].kind, 'publications');
  assert.equal(links[1].kind, 'people');
  assert.equal(links[2].kind, 'opportunities');
});
