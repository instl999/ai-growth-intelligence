import { createHash, randomUUID } from "node:crypto";

export const INTELLIGENCE_CATEGORIES = new Set(["ai", "business", "github", "growth", "skill"]);
export const REVIEW_STATUSES = new Set(["candidate", "publishable", "rejected"]);

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createToolDetails(input) {
  if (!input) return null;
  return {
    name: requiredString(input.name, "tool.name"),
    function: requiredString(input.function, "tool.function"),
    scenarios: (input.scenarios ?? []).map((scenario) => requiredString(scenario, "tool.scenarios")),
    price: requiredString(input.price, "tool.price"),
    officialUrl: canonicalizeUrl(input.officialUrl),
  };
}

export function canonicalizeUrl(value) {
  const url = new URL(requiredString(value, "source.url"));
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || ["fbclid", "gclid"].includes(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function createSource(input) {
  const source = {
    title: requiredString(input.title, "source.title"),
    url: canonicalizeUrl(input.url),
    publisher: requiredString(input.publisher, "source.publisher"),
    publishedAt: requiredString(input.publishedAt, "source.publishedAt"),
    isOfficial: Boolean(input.isOfficial),
  };

  return source;
}

export function createIntelligenceItem(input) {
  const category = requiredString(input.category, "category");
  const reviewStatus = input.reviewStatus ?? "candidate";
  const sources = (input.sources ?? []).map(createSource);

  if (!INTELLIGENCE_CATEGORIES.has(category)) throw new TypeError(`Unsupported category: ${category}`);
  if (!REVIEW_STATUSES.has(reviewStatus)) throw new TypeError(`Unsupported review status: ${reviewStatus}`);
  if (!sources.length) throw new TypeError("At least one source is required.");

  const item = {
    id: input.id ?? randomUUID(),
    category,
    headline: requiredString(input.headline, "headline"),
    // Optional: nothing renders it. It was a required field every entry had to
    // carry for no consumer, and the WeChat digest is built from the article's
    // own opening line instead.
    summary: optionalString(input.summary),
    occurredAt: requiredString(input.occurredAt, "occurredAt"),
    // The latest release or major update. Optional, and only meaningful for the
    // pooled sections, where it is what makes a week-old project today's news.
    lastActivityAt: optionalString(input.lastActivityAt),
    sources,
    reviewStatus,
    materialClaim: Boolean(input.materialClaim),
    valueSignals: {
      efficiency: Boolean(input.valueSignals?.efficiency),
      income: Boolean(input.valueSignals?.income),
      trend: Boolean(input.valueSignals?.trend),
      novelty: Boolean(input.valueSignals?.novelty),
    },
    whatHappened: optionalString(input.whatHappened),
    whyItMatters: optionalString(input.whyItMatters),
    personalImpact: optionalString(input.personalImpact),
    // Finished paragraphs, written by the host AI, with sources attributed in
    // the sentence ("据界面新闻报道，…") the way a 公众号 story does it.
    //
    // This is what lets an entry read as a story rather than a record. The three
    // fields above are single-purpose fragments, so a renderer stitching them
    // together can only ever produce one shape; an article needs the writer to
    // decide where the paragraphs break. When body is absent the layout falls
    // back to composing paragraphs out of those fragments.
    body: (input.body ?? []).map((paragraph) => requiredString(paragraph, "body")),
    // Optional index glyph. The 速览 list leads every line with one, defaulting
    // to the item's category icon.
    icon: optionalString(input.icon),
    actions: (input.actions ?? []).map((action) => requiredString(action, "actions")),
    tool: createToolDetails(input.tool),
    tags: [...new Set((input.tags ?? []).filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim()))],
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return { ...item, fingerprint: input.fingerprint ?? fingerprintItem(item) };
}

export function fingerprintItem(item) {
  const normalizedTitle = requiredString(item.headline, "headline").toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  const canonicalSources = item.sources.map((source) => canonicalizeUrl(source.url)).sort().join("|");
  return createHash("sha256").update(`${normalizedTitle}|${canonicalSources}`).digest("hex");
}

export function createRunRecord({ id = randomUUID(), startedAt = new Date().toISOString(), items = [], ...input } = {}) {
  return {
    id: requiredString(id, "run.id"),
    startedAt: requiredString(startedAt, "run.startedAt"),
    timeWindowHours: input.timeWindowHours ?? 24,
    items: items.map(createIntelligenceItem),
    status: input.status ?? "completed",
  };
}
