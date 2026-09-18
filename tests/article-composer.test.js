import test from "node:test";
import assert from "node:assert/strict";
import { composeArticle, MIN_ITEMS_PER_SECTION } from "../src/core/article-composer.js";
import { createIntelligenceItem } from "../src/core/models.js";

// Sections now filter by their own discovery window, so fixtures are dated
// relative to a pinned clock rather than to an absolute day that ages out.
const NOW = new Date("2026-09-08T12:00:00.000Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
const HOURS_AGO_2 = hoursAgo(2);

function articleItem(overrides = {}, index = 1) {
  const category = overrides.category ?? "ai";
  const tool = Object.hasOwn(overrides, "tool") ? overrides.tool : {
    name: `Example Tool ${index}`,
    function: "Automates workflows",
    scenarios: ["Research", "Content production"],
    price: "Free tier available",
    officialUrl: `https://example.com/tools/${index}`,
  };
  return createIntelligenceItem({
    category,
    reviewStatus: "publishable",
    headline: `${category} verified intelligence ${index}`,
    summary: "Summary.",
    whatHappened: "A verified capability or project update became available.",
    whyItMatters: "It reduces repetitive work and creates a practical opportunity.",
    personalImpact: "It can free time for higher-value work.",
    actions: ["Open the official source and test one small workflow today."],
    occurredAt: HOURS_AGO_2,
    sources: [{ title: `Official update ${index}`, url: `https://example.com/${category}/${index}`, publisher: "Example", publishedAt: "2026-08-04", isOfficial: true }],
    tool,
    ...overrides,
  });
}

function sectionItems(category, count = MIN_ITEMS_PER_SECTION, overrides = {}) {
  return Array.from({ length: count }, (_, index) => articleItem({ category, tool: null, ...overrides }, index + 1));
}

test("renders an entry as a story in paragraphs, not a labelled card", () => {
  const items = Array.from({ length: 5 }, (_, index) => articleItem({}, index + 1));
  const article = composeArticle({ items, now: NOW });
  assert.equal(article.style, "article");
  assert.match(article.markdown, /### ai verified intelligence 1\n/u);
  assert.match(article.markdown, /🧰 Example Tool 1｜/u);
  assert.match(article.markdown, /🔗 \[Example：Official update 1\]\(https:\/\/example\.com\/ai\/1\)/u);
  // None of the card furniture survives: no numbering, no freshness badge, no
  // labelled action block, no rules between entries.
  assert.doesNotMatch(article.markdown, /### 0\d ｜/u);
  assert.doesNotMatch(article.markdown, /🔥/u);
  assert.doesNotMatch(article.markdown, /👉/u);
  assert.doesNotMatch(article.markdown, /^---$/mu);
  for (const oldLabel of ["为什么值得关注", "工具情况", "建议行动", "来源：", "上手"]) {
    assert.doesNotMatch(article.markdown, new RegExp(`\\*\\*${oldLabel}`), `${oldLabel} should not be a field label`);
  }
  assert.equal(article.includedItemCount, 5);
  assert.equal("html" in article, false);
});

test("uses the writer's own paragraphs when they are supplied", () => {
  const body = ["据官方博客报道，第一段。", "第二段，讲清楚发生了什么。", "第三段，说明这对读者意味着什么。"];
  const article = composeArticle({ items: sectionItems("ai", 5, { body }), now: NOW });
  assert.match(article.markdown, /据官方博客报道，第一段。\n\n第二段，讲清楚发生了什么。\n\n第三段，说明这对读者意味着什么。/u);
  // A supplied body replaces the fragments rather than being appended to them.
  assert.doesNotMatch(article.markdown, /It reduces repetitive work/u);
});

test("falls back to segmented paragraphs when no body was written", () => {
  const article = composeArticle({ items: sectionItems("ai"), now: NOW });
  const story = article.markdown.split("### ai verified intelligence 1\n\n")[1].split("🔗")[0];
  // Three paragraphs, not one merged block and not a labelled list.
  assert.equal(story.trim().split("\n\n").length, 3);
  assert.doesNotMatch(story, /：\*\*/u);
});

test("reports how many entries fell back for want of a written body", () => {
  const withBody = sectionItems("ai", 3, { body: ["第一段。", "第二段。"] });
  const without = sectionItems("ai", 2).map((entry, index) => ({ ...entry, headline: `no body ${index}` }));
  const article = composeArticle({ items: [...withBody, ...without], now: NOW });
  // The fallback still renders, so without this count the quality drop is
  // invisible: the briefing looks fine and simply reads worse.
  assert.equal(article.entriesWithoutBody, 2);
  assert.equal(composeArticle({ items: sectionItems("ai", 5, { body: ["正文。"] }), now: NOW }).entriesWithoutBody, 0);
});

test("opens with a 速览 line for every entry, led by its category glyph", () => {
  const article = composeArticle({ items: [...sectionItems("github"), ...sectionItems("ai")], now: NOW });
  const index = article.markdown.split("## GitHub 精选")[0];
  const lines = index.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(lines.length, 10, "every included entry appears in the index");
  assert.equal(lines.filter((line) => line.startsWith("- 💻")).length, 5);
  assert.equal(lines.filter((line) => line.startsWith("- 🧠")).length, 5);
});

test("an item may override its own index glyph", () => {
  const article = composeArticle({ items: sectionItems("ai", 5, { icon: "🚗" }), now: NOW });
  assert.match(article.markdown, /- 🚗 ai verified intelligence 1/u);
});

test("the title is the day's leading headlines, not the column name", () => {
  const article = composeArticle({ items: [...sectionItems("github"), ...sectionItems("ai")], now: NOW });
  assert.equal(article.title, "github verified intelligence 1/ai verified intelligence 1");
  assert.ok(article.title.length <= 64, "WeChat truncates a title over 64 characters");
  assert.match(article.markdown, /^# github verified intelligence 1\/ai verified intelligence 1\n/u);
  // The date moved to the byline so the title spends its characters on news.
  assert.match(article.markdown, /\nAI 成长情报 · 9月8日 · 今天 10 条\n/u);
});

test("a title too long for three headlines falls back to fewer", () => {
  const long = (n) => `这是一条相当长的中文标题用来测试标题长度上限的第 ${n} 条`;
  const article = composeArticle({
    items: [
      ...sectionItems("github", 5, { headline: long(1) }),
      ...sectionItems("ai", 5, { headline: long(2) }),
      ...sectionItems("skill", 5, { headline: long(3) }),
    ],
    now: NOW,
  });
  assert.ok(article.title.length <= 64, `title was ${article.title.length} characters`);
  assert.ok(article.title.split("/").length < 3, "three long headlines cannot all fit");
});

test("keeps four qualifying sections in the approved order", () => {
  const items = [
    ...sectionItems("growth", 2),
    ...sectionItems("skill"),
    ...sectionItems("ai"),
    ...sectionItems("github"),
    ...sectionItems("business", 3),
  ];
  const article = composeArticle({ items, now: NOW });
  assert.equal(article.sectionCount, 4);
  assert.equal(article.includedItemCount, 20);
  const githubIndex = article.markdown.indexOf("## GitHub 精选");
  const aiIndex = article.markdown.indexOf("## AI 情报");
  const skillIndex = article.markdown.indexOf("## Skill 精选");
  const generalIndex = article.markdown.indexOf("## 综合情报");
  assert.ok(githubIndex > -1 && githubIndex < aiIndex && aiIndex < skillIndex && skillIndex < generalIndex);
  // Counts and windows are operator bookkeeping, reported on the object only.
  assert.doesNotMatch(article.markdown, /（\d+ 条/u);
  assert.deepEqual(
    article.sections.map((section) => [section.key, section.itemCount]),
    [["github", 5], ["ai", 5], ["skill", 5], ["general", 5]],
  );
});

test("joins fragments into clean sentences instead of running punctuation together", () => {
  const article = composeArticle({
    items: sectionItems("ai", 5, {
      whatHappened: "一个可验证的能力上线了，",
      personalImpact: "你可以省下重复劳动的时间",
      actions: ["先拿一个小任务试", "再决定要不要全量迁移。"],
    }),
    now: NOW,
  });
  assert.match(article.markdown, /一个可验证的能力上线了。你可以省下重复劳动的时间。/u);
  assert.match(article.markdown, /先拿一个小任务试。再决定要不要全量迁移。/u);
  // The original layout produced "…。；对个人的影响：…" by concatenating raw fields.
  assert.doesNotMatch(article.markdown, /。；|。。|，。/u);
});

test("falls back to the original labelled layout on request", () => {
  const config = { article: { style: "brief" } };
  const items = Array.from({ length: 5 }, (_, index) => articleItem({}, index + 1));
  const article = composeArticle({ items, now: NOW, config });
  assert.equal(article.style, "brief");
  assert.match(article.markdown, /## AI 情报（5 条）/);
  assert.match(article.markdown, /\*\*为什么值得关注：\*\*/);
  assert.match(article.markdown, /\[官网直达\]\(https:\/\/example\.com\/tools\/1\)/);
});

test("an unknown style falls back to the article layout rather than failing", () => {
  const article = composeArticle({ items: sectionItems("ai"), now: NOW, config: { article: { style: "flow" } } });
  assert.equal(article.style, "article");
});

test("omits an underfilled section without padding it", () => {
  const article = composeArticle({ items: [...sectionItems("ai"), ...sectionItems("github", 4)], now: NOW });
  assert.equal(article.sectionCount, 1);
  assert.equal(article.includedItemCount, 5);
  assert.equal(article.omittedItemCount, 4);
  assert.doesNotMatch(article.markdown, /GitHub 精选/);
});

test("adds a disclaimer when a deliverable general section contains finance or business content", () => {
  const article = composeArticle({ items: sectionItems("business"), now: NOW });
  assert.equal(article.includesInvestmentDisclaimer, true);
  assert.match(article.markdown, /不构成任何投资建议/);
});

test("refuses unsafe, incomplete, or underfilled article input", () => {
  assert.throws(() => composeArticle({ items: [], now: NOW }), /No publishable content/);
  assert.throws(() => composeArticle({ items: [articleItem({ reviewStatus: "rejected", now: NOW })] }), /Only publishable/);
  assert.throws(() => composeArticle({ items: [articleItem({ actions: [], now: NOW })] }), /At least one action/);
  assert.throws(() => composeArticle({ items: sectionItems("ai", 4), now: NOW }), /at least 5 qualifying items/);
});