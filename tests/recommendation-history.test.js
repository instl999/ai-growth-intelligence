import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createIntelligenceItem } from "../src/core/models.js";
import { prepareArticlePreview } from "../src/core/preview-workflow.js";
import { RecommendationHistory } from "../src/storage/recommendation-history.js";
import { runCliCommand } from "../src/cli/index.js";
import { writeFile } from "node:fs/promises";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const ago = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

function item(category, index, { occurredAt = ago(2), lastActivityAt } = {}) {
  return createIntelligenceItem({
    category,
    headline: `${category} project ${index}`,
    summary: "It helps reduce repetitive work.",
    whatHappened: "A verified capability became available.",
    whyItMatters: "It reduces time spent on repetitive work.",
    personalImpact: "It frees time for higher-value work.",
    actions: ["Try it on one task."],
    occurredAt,
    ...(lastActivityAt ? { lastActivityAt } : {}),
    sources: [{
      title: `Official ${index}`,
      url: `https://example.com/${category}/${index}`,
      publisher: "Example",
      publishedAt: "2026-09-08",
      isOfficial: true,
    }],
    valueSignals: { efficiency: true, income: true, trend: true },
  });
}

async function withDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agi-history-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("an empty history suppresses nothing", async () => {
  await withDirectory(async (directory) => {
    const history = new RecommendationHistory(path.join(directory, "h.json"));
    assert.deepEqual(await history.load(NOW), {});
  });
});

test("recorded fingerprints come back and suppress a repeat recommendation", async () => {
  await withDirectory(async (directory) => {
    const history = new RecommendationHistory(path.join(directory, "h.json"));
    const items = [1, 2, 3, 4, 5].map((index) => item("github", index));
    const first = prepareArticlePreview({ items, seenFingerprints: await history.load(NOW), now: NOW });
    assert.equal(first.status, "delivery_ready");

    const summary = await history.record(first.publishableItems, NOW);
    assert.equal(summary.added, 5);

    // The same pool one day later: everything is still inside the seven-day
    // window, so only the history stops it being recommended again.
    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const second = prepareArticlePreview({ items, seenFingerprints: await history.load(later), now: later });
    assert.equal(second.status, "no_briefing");
    assert.equal(second.duplicates.length, 5);
  });
});

test("a new release does not escape suppression by changing the activity date", async () => {
  await withDirectory(async (directory) => {
    const history = new RecommendationHistory(path.join(directory, "h.json"));
    const original = item("github", 1);
    await history.record([original], NOW);
    const updated = item("github", 1, { lastActivityAt: ago(1) });
    assert.equal(updated.fingerprint, original.fingerprint, "identity is the headline and sources, not the date");
    assert.ok((await history.load(NOW))[updated.fingerprint]);
  });
});

test("entries older than the retention window stop suppressing", async () => {
  await withDirectory(async (directory) => {
    const history = new RecommendationHistory(path.join(directory, "h.json"), { retentionDays: 30 });
    await history.record([item("github", 1)], new Date("2026-07-01T00:00:00.000Z"));
    assert.deepEqual(await history.load(NOW), {}, "a 69-day-old entry must not suppress forever");
  });
});

test("recording prunes expired entries and reports the counts", async () => {
  await withDirectory(async (directory) => {
    const history = new RecommendationHistory(path.join(directory, "h.json"), { retentionDays: 30 });
    await history.record([item("github", 1)], new Date("2026-07-01T00:00:00.000Z"));
    const summary = await history.record([item("github", 2)], NOW);
    assert.equal(summary.added, 1);
    assert.equal(summary.pruned, 1);
    assert.equal(summary.total, 1);
  });
});

test("items without a fingerprint are ignored rather than stored as undefined", async () => {
  await withDirectory(async (directory) => {
    const history = new RecommendationHistory(path.join(directory, "h.json"));
    const summary = await history.record([{ headline: "no fingerprint" }, null], NOW);
    assert.equal(summary.added, 0);
    assert.equal(summary.total, 0);
  });
});

test("delivery-plan reports what history suppressed, and record-delivered persists it", async () => {
  await withDirectory(async (directory) => {
    const itemsPath = path.join(directory, "items.json");
    const items = [
      ...[1, 2, 3, 4, 5].map((index) => item("github", index)),
      ...[1, 2, 3, 4, 5].map((index) => item("ai", index)),
    ];
    await writeFile(itemsPath, JSON.stringify({ items }), "utf8");
    const history = new RecommendationHistory(path.join(directory, "h.json"));

    const first = await runCliCommand(["delivery-plan", "--items", itemsPath, "--message-tool"], { history, now: NOW });
    assert.equal(first.status, "delivery_ready");
    assert.equal(first.deduplication.previouslyRecommended, 0);
    assert.equal(first.deduplication.suppressedThisRun, 0);

    const recorded = await runCliCommand(["record-delivered", "--items", itemsPath], { history, now: NOW });
    assert.equal(recorded.status, "recorded");
    assert.equal(recorded.added, 10);

    const second = await runCliCommand(["delivery-plan", "--items", itemsPath, "--message-tool"], { history, now: NOW });
    assert.equal(second.deduplication.previouslyRecommended, 10);
    assert.equal(second.deduplication.suppressedThisRun, 10);
    assert.equal(second.status, "no_briefing");
  });
});

test("--no-history opts out of local state entirely", async () => {
  await withDirectory(async (directory) => {
    const itemsPath = path.join(directory, "items.json");
    const items = [1, 2, 3, 4, 5].map((index) => item("github", index));
    await writeFile(itemsPath, JSON.stringify({ items }), "utf8");
    const result = await runCliCommand(
      ["delivery-plan", "--items", itemsPath, "--message-tool", "--no-history"],
      { now: NOW },
    );
    assert.equal(result.deduplication.previouslyRecommended, 0);
  });
});

test("delivery-plan surfaces the per-section windows it applied", async () => {
  await withDirectory(async (directory) => {
    const itemsPath = path.join(directory, "items.json");
    const items = [
      ...[1, 2, 3, 4, 5].map((index) => item("github", index, { occurredAt: ago(4 * 24) })),
      ...[1, 2, 3, 4, 5].map((index) => item("ai", index)),
    ];
    await writeFile(itemsPath, JSON.stringify({ items }), "utf8");
    const result = await runCliCommand(
      ["delivery-plan", "--items", itemsPath, "--message-tool", "--no-history"],
      { now: NOW },
    );
    const github = result.sections.find((section) => section.key === "github");
    const ai = result.sections.find((section) => section.key === "ai");
    assert.equal(github.discoveryWindowHours, 24 * 7, "four-day-old repositories still qualify");
    assert.equal(github.itemCount, 5);
    assert.equal(ai.discoveryWindowHours, 24);
  });
});
