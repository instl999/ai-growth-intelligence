import test from "node:test";
import assert from "node:assert/strict";
import { createIntelligenceItem } from "../src/core/models.js";
import { prepareArticlePreview } from "../src/core/preview-workflow.js";

// Pinned clock: section windows are judged against it, so the fixtures stay
// valid regardless of when the suite runs.
const NOW = new Date("2026-09-08T12:00:00.000Z");
const HOURS_AGO_2 = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();

function candidate(index = 1, overrides = {}) {
  const category = overrides.category ?? "ai";
  return createIntelligenceItem({
    category,
    headline: `${category} high-value update ${index}`,
    summary: "It helps reduce repetitive work.",
    whatHappened: "A verified capability became available.",
    whyItMatters: "It can reduce time spent on repetitive work.",
    personalImpact: "It can free time for higher-value tasks.",
    actions: ["Test the workflow on one repetitive task."],
    occurredAt: HOURS_AGO_2,
    sources: [{ title: `Official launch ${index}`, url: `https://example.com/${category}/launch-${index}`, publisher: "Example", publishedAt: "2026-08-04", isOfficial: true }],
    valueSignals: { efficiency: true, income: true, trend: true },
    ...overrides,
  });
}

function candidates(count, category = "ai", start = 1) {
  return Array.from({ length: count }, (_, offset) => candidate(start + offset, { category }));
}

test("prepares a dense directly deliverable briefing when a section reaches five", () => {
  const result = prepareArticlePreview({ items: [...candidates(5), candidate(6, { headline: "Political election update" })], now: NOW });
  assert.equal(result.status, "delivery_ready");
  assert.equal(result.publishableItems.length, 6);
  assert.equal(result.omittedItems.length, 0);
  // Item counts live in article.sections for the operator; the heading the
  // reader sees carries no bookkeeping.
  assert.match(result.article.markdown, /## AI 情报/);
  assert.deepEqual(result.article.sections.map((section) => [section.key, section.itemCount]), [["ai", 6]]);
  assert.equal("html" in result.article, false);
  assert.equal("internalReviewItems" in result, false);
});

test("returns no briefing and reports qualifying omissions when a section has fewer than five", () => {
  const result = prepareArticlePreview({ items: candidates(4), now: NOW });
  assert.equal(result.status, "no_briefing");
  assert.equal(result.reason, "本时段无合格高价值情报");
  assert.equal(result.publishableItems.length, 0);
  assert.equal(result.omittedItems.length, 4);
});

test("combines business and growth items toward the five-item general threshold", () => {
  const result = prepareArticlePreview({ items: [...candidates(3, "business"), ...candidates(2, "growth", 10)], now: NOW });
  assert.equal(result.status, "delivery_ready");
  assert.equal(result.publishableItems.length, 5);
  assert.match(result.article.markdown, /## 综合情报/);
  assert.deepEqual(result.article.sections.map((section) => [section.key, section.itemCount]), [["general", 5]]);
});

test("returns a concise no-briefing result when candidates do not meet value requirements", () => {
  const result = prepareArticlePreview({ items: candidates(5).map((item) => ({ ...item, valueSignals: { novelty: true }, now: NOW })) });
  assert.equal(result.status, "no_briefing");
  assert.equal(result.reason, "本时段无合格高价值情报");
  assert.equal(result.rejectedItems.length, 5);
});

test("removes duplicate candidates before applying the five-item threshold", () => {
  const originals = candidates(5);
  const duplicate = createIntelligenceItem({ ...originals[0], id: undefined, fingerprint: originals[0].fingerprint });
  const result = prepareArticlePreview({ items: [...originals, duplicate], now: NOW });
  assert.equal(result.status, "delivery_ready");
  assert.equal(result.publishableItems.length, 5);
  assert.equal(result.duplicates.length, 1);
});