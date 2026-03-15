import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lookupRateMyProfessors, lookupResearchGate, lookupSupplementalSources } from '../src/supplemental-sources.mjs';

function relayHtml(store) {
  return `<html><head></head><body><script>window.__RELAY_STORE__ = ${JSON.stringify(store)};</script></body></html>`;
}

test('lookupRateMyProfessors matches teacher within matched school', async () => {
  const schoolStore = {
    'School-1074': {
      __typename: 'School',
      name: 'UC Irvine',
      legacyId: 1074,
      city: 'Irvine',
      state: 'CA',
    },
  };
  const teacherStore = {
    'Teacher-1370397': {
      __typename: 'Teacher',
      firstName: 'Daniel',
      lastName: 'Whiteson',
      legacyId: 1370397,
      avgRating: 3.4,
      numRatings: 36,
      wouldTakeAgainPercent: 57.8947,
      avgDifficulty: 3.4,
      department: 'Physics & Astronomy',
    },
  };

  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/search/professors?q=')) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <a class="TeacherCard__StyledTeacherCard-syjs0d-0" href="/professor/1370397">
            <div class="CardName__StyledCardName-sc-1gyrgim-0">Daniel Whiteson</div>
            <div class="CardSchool__Department-sc-19lmz2k-0">Physics &amp; Astronomy</div>
            <div class="CardSchool__School-sc-19lmz2k-1">UC Irvine</div>
            <div class="CardNumRating__CardNumRatingNumber-sc-17t4b9u-2">3.4</div>
            <div class="CardNumRating__CardNumRatingCount-sc-17t4b9u-3">36 ratings</div>
            <div class="CardFeedback__CardFeedbackNumber-lq6nix-2">58%</div>
            <div class="CardFeedback__CardFeedbackNumber-lq6nix-2">3.4</div>
          </a>
        `,
      };
    }
    if (requestUrl.includes('/search/schools')) {
      return {
        ok: true,
        status: 200,
        text: async () => relayHtml(schoolStore),
      };
    }
    if (requestUrl.includes('/search/professors/1074')) {
      return {
        ok: true,
        status: 200,
        text: async () => relayHtml(teacherStore),
      };
    }
    throw new Error(`Unexpected URL ${requestUrl}`);
  };

  const result = await lookupRateMyProfessors({
    name: 'Daniel Whiteson',
    institution: 'University of California, Irvine',
    researchField: 'particle physics',
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.status, 'matched');
  assert.equal(result.school, 'UC Irvine');
  assert.equal(result.numRatings, 36);
  assert.equal(result.avgDifficulty, 3.4);
});

test('lookupResearchGate reports blocked when Cloudflare forbids access', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    text: async () => 'Attention Required! | Cloudflare',
  });

  const result = await lookupResearchGate({
    name: 'Daniel Whiteson',
    institution: 'University of California, Irvine',
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.status, 'blocked');
});

test('lookupSupplementalSources returns the three configured source buckets', async () => {
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/search/professors?q=')) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <a class="TeacherCard__StyledTeacherCard-syjs0d-0" href="/professor/1370397">
            <div class="CardName__StyledCardName-sc-1gyrgim-0">Daniel Whiteson</div>
            <div class="CardSchool__Department-sc-19lmz2k-0">Physics &amp; Astronomy</div>
            <div class="CardSchool__School-sc-19lmz2k-1">UC Irvine</div>
            <div class="CardNumRating__CardNumRatingNumber-sc-17t4b9u-2">3.4</div>
            <div class="CardNumRating__CardNumRatingCount-sc-17t4b9u-3">36 ratings</div>
            <div class="CardFeedback__CardFeedbackNumber-lq6nix-2">58%</div>
            <div class="CardFeedback__CardFeedbackNumber-lq6nix-2">3.4</div>
          </a>
        `,
      };
    }
    if (requestUrl.includes('/search/schools')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          relayHtml({
            School: { __typename: 'School', name: 'UC Irvine', legacyId: 1074 },
          }),
      };
    }
    if (requestUrl.includes('/search/professors/1074')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          relayHtml({
            Teacher: {
              __typename: 'Teacher',
              firstName: 'Daniel',
              lastName: 'Whiteson',
              legacyId: 1370397,
              avgRating: 3.4,
              numRatings: 36,
              wouldTakeAgainPercent: 57.8947,
              avgDifficulty: 3.4,
              department: 'Physics & Astronomy',
            },
          }),
      };
    }
    if (requestUrl.includes('researchgate.net')) {
      return {
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      };
    }
    if (requestUrl.includes('zotero.org')) {
      return {
        ok: true,
        status: 200,
        text: async () => '<html>Zotero</html>',
      };
    }
    throw new Error(`Unexpected URL ${requestUrl}`);
  };

  const result = await lookupSupplementalSources({
    name: 'Daniel Whiteson',
    institution: 'University of California, Irvine',
    researchField: 'particle physics',
    fetchImpl,
  });

  assert.equal(result.rateMyProfessors.status, 'matched');
  assert.equal(result.researchGate.status, 'blocked');
  assert.equal(result.zotero.status, 'available');
});
