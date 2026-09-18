/**
 * Per-section discovery windows.
 *
 * News-shaped intelligence and project-shaped intelligence do not age the same
 * way. An AI announcement is stale a day later. A repository or a Skill often
 * becomes worth recommending days after it first appeared, when it ships a
 * release, gets adopted, or simply surfaces. Holding both to a 24-hour window
 * meant the project sections regularly had nothing to say, and the only way to
 * reach the five-item minimum was to pad with weak repositories.
 *
 * So the window is a property of the section:
 *
 *   AI 情报 / 综合情报   24 hours   - news, stale quickly
 *   GitHub 精选 / Skill 精选   7 days   - a pool, ranked by what moved today
 *
 * Widening the pool is not the same as lowering the bar. Everything still has
 * to clear source validation and the value score; the wider window only changes
 * which candidates are eligible to be judged. Within a pool section, anything
 * that released or shipped a major update in the last 24 hours ranks first and
 * is marked in the article, so a seven-day pool still reads as today's briefing.
 */

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_SECTION_POLICIES = Object.freeze([
  Object.freeze({
    key: "github",
    label: "GitHub 精选",
    categories: Object.freeze(["github"]),
    discoveryWindowHours: 24 * 7,
    highlightWindowHours: 24,
    minItems: 5,
    maxItems: 10,
    pooled: true,
  }),
  Object.freeze({
    key: "ai",
    label: "AI 情报",
    categories: Object.freeze(["ai"]),
    discoveryWindowHours: 24,
    highlightWindowHours: 24,
    minItems: 5,
    maxItems: 10,
    pooled: false,
  }),
  Object.freeze({
    key: "skill",
    label: "Skill 精选",
    categories: Object.freeze(["skill"]),
    discoveryWindowHours: 24 * 7,
    highlightWindowHours: 24,
    minItems: 5,
    maxItems: 10,
    pooled: true,
  }),
  Object.freeze({
    key: "general",
    label: "综合情报",
    categories: Object.freeze(["business", "growth"]),
    discoveryWindowHours: 24,
    highlightWindowHours: 24,
    minItems: 5,
    maxItems: 10,
    pooled: false,
  }),
]);

function boundedHours(value, fallback, { minimum = 1, maximum = 24 * 30 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function boundedCount(value, fallback, { minimum = 1, maximum = 50 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

/**
 * Apply `config.sections` overrides on top of the defaults.
 * Unknown section keys are ignored rather than silently creating a section.
 */
export function resolveSectionPolicies(config = {}) {
  const overrides = config?.sections ?? {};
  return DEFAULT_SECTION_POLICIES.map((policy) => {
    const override = overrides[policy.key] ?? {};
    const minItems = boundedCount(override.minItems, policy.minItems);
    const maxItems = boundedCount(override.maxItems, policy.maxItems);
    return {
      ...policy,
      categories: [...policy.categories],
      discoveryWindowHours: boundedHours(override.discoveryWindowHours, policy.discoveryWindowHours),
      highlightWindowHours: boundedHours(override.highlightWindowHours, policy.highlightWindowHours),
      minItems,
      // A maximum below the minimum would make the section unsatisfiable.
      maxItems: Math.max(minItems, maxItems),
    };
  });
}

export function policyForCategory(policies, category) {
  return policies.find((policy) => policy.categories.includes(category)) ?? null;
}

/**
 * When this item last did something worth reporting.
 *
 * `lastActivityAt` is the release or major update; `occurredAt` is when the
 * item first became notable. The later of the two decides both eligibility and
 * ranking, so a repository published a week ago that shipped a release this
 * morning is treated as this morning's news.
 */
export function itemActivityAt(item) {
  const candidates = [item?.lastActivityAt, item?.occurredAt]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return candidates.length ? new Date(Math.max(...candidates)) : null;
}

/**
 * @returns {{activityAt: Date|null, ageHours: number|null, withinWindow: boolean, recentlyUpdated: boolean}}
 */
export function evaluateRecency(item, policy, now = new Date()) {
  const activityAt = itemActivityAt(item);
  if (!activityAt) return { activityAt: null, ageHours: null, withinWindow: false, recentlyUpdated: false };
  const ageHours = (now.getTime() - activityAt.getTime()) / HOUR_MS;
  // Something dated slightly in the future (clock skew on a source) still counts
  // as current rather than being thrown away.
  const withinWindow = ageHours <= policy.discoveryWindowHours;
  return {
    activityAt,
    ageHours,
    withinWindow,
    recentlyUpdated: withinWindow && ageHours <= policy.highlightWindowHours,
  };
}

/**
 * Filter one section's candidates to its window, rank them, and cap the result.
 *
 * Ranking puts anything that moved inside the highlight window first, then
 * orders by most recent activity. The cap keeps a wide pool from turning the
 * briefing into a list dump.
 */
export function rankSectionItems(items = [], policy, now = new Date()) {
  const eligible = [];
  const excluded = [];
  for (const item of items) {
    const recency = evaluateRecency(item, policy, now);
    if (!recency.withinWindow) {
      excluded.push({ item, reason: recency.activityAt ? "outside_discovery_window" : "missing_activity_date" });
      continue;
    }
    eligible.push({ item, recency });
  }

  eligible.sort((left, right) => {
    if (left.recency.recentlyUpdated !== right.recency.recentlyUpdated) {
      return left.recency.recentlyUpdated ? -1 : 1;
    }
    return right.recency.activityAt.getTime() - left.recency.activityAt.getTime();
  });

  const selected = eligible.slice(0, policy.maxItems);
  for (const entry of eligible.slice(policy.maxItems)) excluded.push({ item: entry.item, reason: "section_cap" });

  return {
    selected: selected.map((entry) => ({ ...entry.item, recentlyUpdated: entry.recency.recentlyUpdated })),
    excluded,
    recentlyUpdatedCount: selected.filter((entry) => entry.recency.recentlyUpdated).length,
    eligibleCount: eligible.length,
    meetsMinimum: selected.length >= policy.minItems,
  };
}
