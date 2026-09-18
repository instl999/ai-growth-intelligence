import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, createIntelligenceItem, createRunRecord } from "../src/core/models.js";
import { splitByFingerprint } from "../src/storage/dedup.js";

function itemInput(overrides = {}) {
  return {
    category: "ai",
    headline: "A useful AI release",
    summary: "A concise summary.",
    occurredAt: "2026-07-14T00:00:00.000Z",
    sources: [{
      title: "Official announcement",
      url: "https://example.com/news?utm_source=test",
      publisher: "Example",
      publishedAt: "2026-07-14T00:00:00.000Z",
      isOfficial: true,
    }],
    ...overrides,
  };
}

test("canonicalizes source URLs and creates stable fingerprints", () => {
  assert.equal(canonicalizeUrl("https://example.com/news?utm_source=test#section"), "https://example.com/news");
  const first = createIntelligenceItem(itemInput());
  const second = createIntelligenceItem(itemInput());
  assert.equal(first.fingerprint, second.fingerprint);
});

test("requires a category and at least one source", () => {
  assert.throws(() => createIntelligenceItem(itemInput({ category: "unknown" })), /Unsupported category/);
  assert.throws(() => createIntelligenceItem(itemInput({ sources: [] })), /At least one source/);
});

test("separates stored and same-run duplicates", () => {
  const item = createIntelligenceItem(itemInput());
  const sameItem = createIntelligenceItem(itemInput());
  const result = splitByFingerprint([item, sameItem], {});
  assert.deepEqual(result.unique, [item]);
  assert.deepEqual(result.duplicates, [sameItem]);
  assert.equal(splitByFingerprint([item], { [item.fingerprint]: "2026-07-13" }).duplicates.length, 1);
});

test("creates a run record from validated items", () => {
  const run = createRunRecord({ id: "run_20260714", items: [itemInput()] });
  assert.equal(run.items.length, 1);
  assert.equal(run.timeWindowHours, 24);
});
