import { composeArticle, selectDeliverableItems } from "./article-composer.js";
import { routeItems } from "./assessment.js";
import { splitByFingerprint } from "../storage/dedup.js";

export const DEFAULT_MINIMUM_VALUE_SCORE = 60;

/**
 * The value-score floor, from the explicit argument or the operator's config.
 *
 * `config.minimumValueScore` ships in config.example.json but was never read:
 * every caller passed `config` and none passed `minimumScore`, so raising the
 * bar in configuration silently did nothing. Reading it here fixes it for every
 * caller at once, and an explicit argument still wins.
 */
export function resolveMinimumScore(explicit, config = {}) {
  const candidate = explicit ?? config?.minimumValueScore;
  const number = Number(candidate);
  if (!Number.isFinite(number)) return DEFAULT_MINIMUM_VALUE_SCORE;
  return Math.min(100, Math.max(0, Math.round(number)));
}

export function prepareArticlePreview({ items, seenFingerprints = {}, minimumScore, now = new Date(), config = {} } = {}) {
  const { unique, duplicates } = splitByFingerprint(items ?? [], seenFingerprints);
  const routed = routeItems(unique, { minimumScore: resolveMinimumScore(minimumScore, config) });
  const qualifyingItems = routed.publishable.map((assessment) => assessment.item);
  const publishableItems = selectDeliverableItems(qualifyingItems, { config, now });
  const publishableIds = new Set(publishableItems.map((item) => item.id));
  const omittedItems = qualifyingItems.filter((item) => !publishableIds.has(item.id));

  if (!publishableItems.length) {
    return {
      status: "no_briefing",
      reason: "本时段无合格高价值情报",
      article: null,
      publishableItems: [],
      omittedItems,
      rejectedItems: routed.rejected.map((assessment) => assessment.item),
      duplicates,
    };
  }

  return {
    status: "delivery_ready",
    article: composeArticle({ items: publishableItems, now, config }),
    publishableItems,
    omittedItems,
    rejectedItems: routed.rejected.map((assessment) => assessment.item),
    duplicates,
  };
}