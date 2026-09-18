import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCliCommand } from "../src/cli/index.js";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const ago = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

function item(category, index) {
  return {
    category,
    headline: `${category} 项目 ${index}`,
    summary: "It helps reduce repetitive work.",
    whatHappened: "一个可验证的能力上线了",
    whyItMatters: "它把一件重复的事变成一条命令",
    personalImpact: "你可以把省下的时间放到更值钱的事情上",
    actions: ["先拿一个小任务试一次"],
    occurredAt: ago(2),
    sources: [{
      title: `Official ${index}`,
      url: `https://example.com/${category}/${index}`,
      publisher: "Example",
      publishedAt: "2026-09-08",
      isOfficial: true,
    }],
    valueSignals: { efficiency: true, income: true, trend: true },
  };
}

async function withItemsFile(items, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agi-preview-"));
  try {
    const itemsPath = path.join(directory, "items.json");
    await writeFile(itemsPath, JSON.stringify({ items }), "utf8");
    return await callback(itemsPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const fiveAiItems = [1, 2, 3, 4, 5].map((index) => item("ai", index));

test("--markdown returns the briefing itself, not a JSON envelope", async () => {
  await withItemsFile(fiveAiItems, async (itemsPath) => {
    const result = await runCliCommand(
      ["preview-article", "--items", itemsPath, "--markdown", "--no-history"],
      { now: NOW },
    );
    // A JSON-escaped briefing is unreadable, which defeats the point of looking
    // at the layout, so this command returns raw text the runner prints as-is.
    assert.equal(typeof result, "string");
    assert.match(result, /^# ai 项目 1\n/u);
    assert.match(result, /\nAI 成长情报 · 9月8日 · 今天 5 条\n/u);
  });
});

test("the JSON form carries the pieces a WeChat draft needs", async () => {
  await withItemsFile(fiveAiItems, async (itemsPath) => {
    const result = await runCliCommand(["preview-article", "--items", itemsPath, "--no-history"], { now: NOW });
    assert.equal(result.status, "delivery_ready");
    assert.equal(result.style, "article");
    assert.ok(result.title.length <= 64, "a title over 64 characters would be truncated by WeChat");
    assert.ok(result.digest.length <= 120, "a digest over 120 characters would be truncated by WeChat");
    assert.deepEqual(result.sections.map((section) => section.key), ["ai"]);
  });
});

test("--style compares layouts without editing the config file", async () => {
  await withItemsFile(fiveAiItems, async (itemsPath) => {
    const brief = await runCliCommand(
      ["preview-article", "--items", itemsPath, "--style", "brief", "--no-history"],
      { now: NOW },
    );
    assert.equal(brief.style, "brief");
    assert.match(brief.markdown, /\*\*为什么值得关注：\*\*/u);
  });
});

test("an unusable style is refused rather than silently ignored", async () => {
  await withItemsFile(fiveAiItems, async (itemsPath) => {
    await assert.rejects(
      runCliCommand(["preview-article", "--items", itemsPath, "--style", "fancy", "--no-history"], { now: NOW }),
      (error) => error.code === "invalid_style",
    );
  });
});

test("an underfilled briefing previews as the no-content message, in both forms", async () => {
  await withItemsFile([item("ai", 1)], async (itemsPath) => {
    const envelope = await runCliCommand(["preview-article", "--items", itemsPath, "--no-history"], { now: NOW });
    assert.equal(envelope.status, "no_briefing");
    assert.equal(envelope.reason, "本时段无合格高价值情报");
    const text = await runCliCommand(
      ["preview-article", "--items", itemsPath, "--markdown", "--no-history"],
      { now: NOW },
    );
    assert.equal(text, "本时段无合格高价值情报");
  });
});
