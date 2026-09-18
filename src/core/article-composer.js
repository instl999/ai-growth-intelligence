import { policyForCategory, rankSectionItems, resolveSectionPolicies } from "./section-policy.js";

/** Kept for callers that only need the floor; the real value lives per section. */
export const MIN_ITEMS_PER_SECTION = 5;

/**
 * How a briefing is laid out.
 *
 * "article" is the default and follows the shape a Chinese daily tech roundup
 * actually uses: a title made of the day's leading headlines, a 速览 index of
 * every entry, then each entry written out as a short story in paragraphs, with
 * its sources attributed inside the sentences.
 *
 * It replaced a card layout that numbered every entry, badged it, split it into
 * a hook plus one merged paragraph, and closed it with a labelled action block.
 * That was still a list of records wearing better typography — the reader was
 * parsing a structure rather than reading. The fix is not more styling; it is
 * that the writer, not the renderer, decides where paragraphs break.
 *
 * "brief" is the original label-per-line layout, kept for anyone who scripted
 * against it.
 */
export const ARTICLE_STYLES = Object.freeze(["article", "brief"]);
export const DEFAULT_ARTICLE_STYLE = "article";

/**
 * Line prefixes that mark a line's role.
 *
 * The WeChat renderer styles these differently from body prose and keys off the
 * exact strings, so it imports them from here rather than repeating the emoji.
 */
export const LINE_MARKERS = Object.freeze({
  source: "🔗",
  tool: "🧰",
});

/**
 * Index glyphs for the 速览 list, overridable per item via `icon`.
 *
 * Single code points only. A ZWJ sequence such as 🧑‍💻 degrades to a bare
 * component glyph wherever the font lacks the composed form, and the reference
 * roundups use only simple emoji for the same reason.
 */
const CATEGORY_ICONS = Object.freeze({
  github: "💻",
  ai: "🧠",
  skill: "🧩",
  business: "💵",
  growth: "💡",
});

/** Sentence-final punctuation, so two fragments can be joined without doubling it. */
const SENTENCE_ENDINGS = new Set(["。", "！", "？", "…", ".", "!", "?", "」", "》", "”"]);
/** Trailing connectors that must go before a fragment becomes its own sentence. */
const DANGLING_PUNCTUATION = /[，、；,;\s]+$/u;

/** WeChat rejects a title over 64 characters, and a long one truncates badly. */
const MAX_TITLE_LENGTH = 60;

function safeUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new TypeError("Only HTTP(S) links are allowed in article output.");
  return url.toString();
}

function markdownText(value) {
  return String(value).replace(/([\\`*_[\]<>])/g, "\\$1");
}

/**
 * Normalize a fragment into a standalone sentence.
 *
 * Fields arrive punctuated inconsistently. Concatenating them raw produced
 * `…4300 star。；对个人的影响：…`, a full stop followed by a semicolon.
 */
function asSentence(value) {
  const trimmed = String(value ?? "").trim().replace(DANGLING_PUNCTUATION, "");
  if (!trimmed) return "";
  return SENTENCE_ENDINGS.has(trimmed.at(-1)) ? trimmed : `${trimmed}。`;
}

function truncate(value, limit) {
  const flat = String(value ?? "").replace(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

function requireArticleFields(item) {
  if (item.reviewStatus !== "publishable") throw new TypeError("Only publishable items can be rendered into an article.");
  for (const field of ["whatHappened", "whyItMatters", "personalImpact"]) if (!item[field]) throw new TypeError(`${field} is required for article output.`);
  if (!item.actions?.length) throw new TypeError("At least one action is required for article output.");
  if (item.tool && (!item.tool.scenarios?.length || !item.tool.officialUrl)) throw new TypeError("AI tool entries require scenarios and an official URL.");
}

function renderSources(sources) {
  return sources.map((source) => `[${markdownText(source.publisher)}：${markdownText(source.title)}](${safeUrl(source.url)})`).join("；");
}

function renderTool(tool) {
  if (!tool) return "";
  return `- **功能与使用：** ${markdownText(tool.name)}｜${markdownText(tool.function)}｜场景：${tool.scenarios.map(markdownText).join("、")}｜价格：${markdownText(tool.price)}｜[官网直达](${safeUrl(tool.officialUrl)})`;
}

function situationLabel(item) {
  if (item.category === "github") return "项目情况";
  if (item.category === "skill") return "Skill 情况";
  if (item.category === "ai" && item.tool) return "工具情况";
  if (item.category === "ai") return "AI 情报情况";
  return "机会、风险与未来影响";
}

function renderBriefItem(item, index) {
  const actions = item.actions.map(markdownText).join("；");
  const tool = renderTool(item.tool);
  return [
    `### ${index + 1}. ${markdownText(item.headline)}`,
    `- **为什么值得关注：** ${markdownText(item.whyItMatters)}`,
    `- **${situationLabel(item)}：** ${markdownText(item.whatHappened)}；对个人的影响：${markdownText(item.personalImpact)}`,
    `- **建议行动：** ${actions}`,
    tool,
    `- **来源：** ${renderSources(item.sources)}`,
  ].filter(Boolean).join("\n");
}

function renderArticleTool(tool) {
  if (!tool) return "";
  const scenarios = tool.scenarios.map(markdownText).join("、");
  return `${LINE_MARKERS.tool} ${markdownText(tool.name)}｜${markdownText(tool.function)}｜场景：${scenarios}｜价格：${markdownText(tool.price)}｜[官网](${safeUrl(tool.officialUrl)})`;
}

/**
 * The paragraphs of one story.
 *
 * `body` is used verbatim when the writer supplied it. Otherwise the fragments
 * are split across three paragraphs — the reason first, then what happened and
 * what it changes, then what to do — which is still segmented prose rather than
 * one labelled block.
 */
function articleParagraphs(item) {
  if (item.body?.length) return item.body.map((paragraph) => markdownText(asSentence(paragraph)));
  return [
    markdownText(asSentence(item.whyItMatters)),
    `${markdownText(asSentence(item.whatHappened))}${markdownText(asSentence(item.personalImpact))}`,
    markdownText(item.actions.map(asSentence).join("")),
  ].filter(Boolean);
}

/**
 * One entry as a story: a plain headline, paragraphs, then its sources.
 *
 * No number, no badge and no action label. Writers are told to attribute
 * sources inside the prose the way a 公众号 story does; the trailing link line
 * stays because this Skill's contract is that every claim remains checkable.
 */
function renderArticleItem(item) {
  return [
    `### ${markdownText(item.headline)}`,
    "",
    articleParagraphs(item).join("\n\n"),
    ...(item.tool ? ["", renderArticleTool(item.tool)] : []),
    "",
    `${LINE_MARKERS.source} ${renderSources(item.sources)}`,
  ].join("\n");
}

function indexIcon(item) {
  return item.icon ?? CATEGORY_ICONS[item.category] ?? "•";
}

/**
 * The 速览 list: every entry as one line, led by its category glyph.
 *
 * This is the piece that makes a long roundup scrollable. A reader takes the
 * whole day in at a glance and then drops into whichever stories they want,
 * which is exactly what the previous three-headline teaser could not do.
 */
function renderIndex(includedItems) {
  return includedItems.map((item) => `- ${indexIcon(item)} ${markdownText(item.headline)}`).join("\n");
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(date);
}

/**
 * "9月17日" in Shanghai time.
 *
 * Built from numeric parts rather than `month: "long"`, which renders as a
 * Chinese numeral ("九月") on some ICU builds.
 */
function formatDateLabel(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return `${value("month")}月${value("day")}日`;
}

/**
 * The title: the day's leading headlines, slash-separated.
 *
 * Three if they fit, then two, then one truncated — a daily roundup is sold by
 * what is in it, not by the name of the column.
 */
function buildArticleTitle(activeSections) {
  const leads = activeSections.map((section) => section.selected[0].headline);
  for (const count of [3, 2]) {
    const candidate = leads.slice(0, count).join("/");
    if (leads.length >= count && candidate.length <= MAX_TITLE_LENGTH) return candidate;
  }
  return truncate(leads[0], MAX_TITLE_LENGTH);
}

function groupItems(items, policies) {
  const grouped = new Map(policies.map((policy) => [policy.key, []]));
  for (const item of items) {
    const policy = policyForCategory(policies, item.category);
    if (policy) grouped.get(policy.key).push(item);
  }
  return grouped;
}

/**
 * Apply each section's own discovery window, ranking and caps.
 *
 * Returns one entry per section that reached its minimum, in display order.
 */
export function planSections({ items = [], config = {}, now = new Date() } = {}) {
  const policies = resolveSectionPolicies(config);
  const grouped = groupItems(items, policies);
  return policies
    .map((policy) => ({ policy, ...rankSectionItems(grouped.get(policy.key), policy, now) }))
    .filter((section) => section.meetsMinimum);
}

export function selectDeliverableItems(items = [], { config = {}, now = new Date() } = {}) {
  return planSections({ items, config, now }).flatMap((section) => section.selected);
}

export function resolveArticleStyle(config = {}) {
  const requested = config?.article?.style;
  return ARTICLE_STYLES.includes(requested) ? requested : DEFAULT_ARTICLE_STYLE;
}

function buildBriefDigest(activeSections, includedItemCount) {
  const pooled = activeSections.filter((section) => section.policy.pooled);
  const windowNote = pooled.length
    ? `；${pooled.map((section) => section.policy.label).join("、")}从近 ${Math.round(pooled[0].policy.discoveryWindowHours / 24)} 天的候选池中挑选，优先展示 24 小时内有新版本或重要更新的项目`
    : "";
  return `本期筛选出 ${includedItemCount} 条可验证的高价值情报；新闻类板块取近 24 小时${windowNote}。未达 ${MIN_ITEMS_PER_SECTION} 条门槛的板块已省略，不做凑数。`;
}

export function composeArticle({ items, now = new Date(), config = {} } = {}) {
  if (!items?.length) throw new TypeError("No publishable content is available for an article.");
  items.forEach(requireArticleFields);

  const activeSections = planSections({ items, config, now });
  if (!activeSections.length) throw new TypeError(`No section has at least ${MIN_ITEMS_PER_SECTION} qualifying items inside its discovery window.`);

  const style = resolveArticleStyle(config);
  const includedItems = activeSections.flatMap((section) => section.selected);
  const includesFinance = includedItems.some((item) => item.category === "business");
  const disclaimer = includesFinance ? "\n\n> 财经内容仅供信息参考，不构成任何投资建议。" : "";

  let title;
  let digest;
  let body;

  if (style === "article") {
    title = buildArticleTitle(activeSections);
    // The byline sits where an Official Account puts it: under the title, small,
    // carrying the column name and the date the title no longer has to spend
    // characters on.
    const byline = `AI 成长情报 · ${formatDateLabel(now)} · 今天 ${includedItems.length} 条`;
    digest = `${byline}｜${includedItems.slice(0, 3).map((item) => truncate(item.headline, 22)).join("；")}。`;
    const sections = activeSections.map((section) => {
      const stories = section.selected.map((item) => renderArticleItem(item)).join("\n\n");
      return `## ${section.policy.label}\n\n${stories}`;
    });
    body = `${byline}\n\n${renderIndex(includedItems)}\n\n${sections.join("\n\n")}`;
  } else {
    title = `${formatDate(now)} AI 成长情报：${activeSections.map((section) => section.policy.label).join("、")}`;
    digest = buildBriefDigest(activeSections, includedItems.length);
    const sections = activeSections.map((section) => {
      const fresh = section.recentlyUpdatedCount;
      const heading = section.policy.pooled && fresh
        ? `## ${section.policy.label}（${section.selected.length} 条 · ${fresh} 条 24 小时内有更新）`
        : `## ${section.policy.label}（${section.selected.length} 条）`;
      return `${heading}\n\n${section.selected.map((item, index) => renderBriefItem(item, index)).join("\n\n")}`;
    });
    body = `${digest}\n\n${sections.join("\n\n")}`;
  }

  const markdown = `# ${title}\n\n${body} ${disclaimer}`.trim();

  return {
    title,
    digest,
    markdown,
    style,
    sectionCount: activeSections.length,
    includedItemCount: includedItems.length,
    omittedItemCount: items.length - includedItems.length,
    includesInvestmentDisclaimer: includesFinance,
    // How many entries fell back to fragment-assembled paragraphs because no
    // body was written. The output still renders, so without this the quality
    // drop is invisible: the briefing looks fine and simply reads worse.
    entriesWithoutBody: includedItems.filter((item) => !item.body?.length).length,
    sections: activeSections.map((section) => ({
      key: section.policy.key,
      label: section.policy.label,
      itemCount: section.selected.length,
      recentlyUpdatedCount: section.recentlyUpdatedCount,
      discoveryWindowHours: section.policy.discoveryWindowHours,
      eligibleCount: section.eligibleCount,
    })),
  };
}
