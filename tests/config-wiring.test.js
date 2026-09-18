// Configuration that ships in config.example.json but reaches nothing is worse
// than configuration that does not exist: the operator sets it, sees no error,
// and believes it took effect. These tests pin each knob to an observable
// difference in output.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createIntelligenceItem } from "../src/core/models.js";
import { prepareArticlePreview, resolveMinimumScore, DEFAULT_MINIMUM_VALUE_SCORE } from "../src/core/preview-workflow.js";
import { RecommendationHistory, resolveRetentionDays, DEFAULT_RETENTION_DAYS } from "../src/storage/recommendation-history.js";
import { runWechatCommand } from "../src/wechat/command.js";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const ago = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

/** `valueSignals` drives the score, so a thin item scores low and a rich one high. */
function item(index, { rich = true } = {}) {
  return createIntelligenceItem({
    category: "ai",
    headline: `ai 项目 ${index}`,
    whatHappened: "一个可验证的能力上线了",
    whyItMatters: "它把一件重复的事变成一条命令",
    personalImpact: "你可以把省下的时间放到更值钱的事情上",
    actions: ["先拿一个小任务试一次"],
    occurredAt: ago(2),
    sources: [{
      title: `Official ${index}`,
      url: `https://example.com/ai/${index}`,
      publisher: "Example",
      publishedAt: "2026-09-08",
      isOfficial: true,
    }],
    // efficiency + income = 60, exactly the default floor. The scale tops out
    // at 100, so a fully-signalled item cannot be rejected by any valid floor.
    valueSignals: rich
      ? { efficiency: true, income: true }
      : { novelty: true },
  });
}

const fiveRich = [1, 2, 3, 4, 5].map((index) => item(index));

async function withDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agi-config-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// -- minimumValueScore -------------------------------------------------------

test("config.minimumValueScore raises the bar instead of being ignored", () => {
  const passes = prepareArticlePreview({ items: fiveRich, now: NOW, config: {} });
  assert.equal(passes.status, "delivery_ready", "these items clear the default floor");

  const raised = prepareArticlePreview({ items: fiveRich, now: NOW, config: { minimumValueScore: 70 } });
  assert.equal(raised.status, "no_briefing", "a floor of 70 must reject items scoring 60");
  assert.equal(raised.rejectedItems.length, 5);
});

test("an explicit minimumScore still wins over the configured one", () => {
  const result = prepareArticlePreview({ items: fiveRich, now: NOW, minimumScore: 0, config: { minimumValueScore: 99 } });
  assert.equal(result.status, "delivery_ready");
});

test("an unusable minimumValueScore falls back rather than rejecting everything", () => {
  assert.equal(resolveMinimumScore(undefined, {}), DEFAULT_MINIMUM_VALUE_SCORE);
  assert.equal(resolveMinimumScore(undefined, { minimumValueScore: "not a number" }), DEFAULT_MINIMUM_VALUE_SCORE);
  assert.equal(resolveMinimumScore(undefined, { minimumValueScore: 85 }), 85);
  // Out-of-range values are clamped, not taken literally.
  assert.equal(resolveMinimumScore(undefined, { minimumValueScore: -20 }), 0);
  assert.equal(resolveMinimumScore(undefined, { minimumValueScore: 500 }), 100);
});

// -- recommendationHistoryDays -----------------------------------------------

test("retention days are bounded so deduplication cannot be silently disabled", () => {
  assert.equal(resolveRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
  assert.equal(resolveRetentionDays(7), 7);
  // Zero would expire every fingerprint immediately, which looks exactly like
  // deduplication working and recommending nothing twice by luck.
  assert.equal(resolveRetentionDays(0), 1);
  assert.equal(resolveRetentionDays(-5), 1);
  assert.equal(resolveRetentionDays(99999), 365);
});

test("a configured retention window actually changes what is suppressed", async () => {
  await withDirectory(async (directory) => {
    const filePath = path.join(directory, "h.json");
    const recorded = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    await new RecommendationHistory(filePath, { retentionDays: 30 }).record([item(1)], recorded);

    const wide = await new RecommendationHistory(filePath, { retentionDays: 30 }).load(NOW);
    assert.equal(Object.keys(wide).length, 1, "a 10-day-old entry is inside a 30-day window");

    const narrow = await new RecommendationHistory(filePath, { retentionDays: 3 }).load(NOW);
    assert.equal(Object.keys(narrow).length, 0, "and outside a 3-day one");
  });
});

// -- the WeChat draft path ---------------------------------------------------

test("a WeChat draft is composed with the operator's config, not with defaults", async () => {
  await withDirectory(async (directory) => {
    const itemsPath = path.join(directory, "items.json");
    const configPath = path.join(directory, "config.json");
    await writeFile(itemsPath, JSON.stringify({ items: fiveRich }), "utf8");
    await writeFile(configPath, JSON.stringify({
      article: { style: "brief" },
      wechatDraftBox: { enabled: true, dryRun: true },
    }), "utf8");

    const result = await runWechatCommand(
      "wechat-draft",
      ["--config", configPath, "--items", itemsPath, "--mode", "dry_run"],
      { now: NOW },
    );
    assert.equal(result.status, "dry_run");
    // Before the fix the draft was always composed under defaults, so the one
    // output where layout matters most ignored article.style entirely.
    assert.match(result.html, /为什么值得关注/u);
  });
});

test("a WeChat draft honours a configured section minimum", async () => {
  await withDirectory(async (directory) => {
    const itemsPath = path.join(directory, "items.json");
    const configPath = path.join(directory, "config.json");
    await writeFile(itemsPath, JSON.stringify({ items: fiveRich }), "utf8");
    await writeFile(configPath, JSON.stringify({
      sections: { ai: { minItems: 6 } },
      wechatDraftBox: { enabled: true, dryRun: true },
    }), "utf8");

    await assert.rejects(
      runWechatCommand("wechat-draft", ["--config", configPath, "--items", itemsPath, "--mode", "dry_run"], { now: NOW }),
      (error) => error.code === "no_publishable_article",
      "five items must not satisfy a configured minimum of six",
    );
  });
});
