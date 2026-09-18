/**
 * What has already been recommended.
 *
 * `IntelligenceStore` could record fingerprints from the start, but nothing
 * ever called it, so the deduplication in `prepareArticlePreview` always ran
 * against an empty index. That was survivable while every section drew from a
 * 24-hour window, because yesterday's news rarely resurfaces. It is not
 * survivable with a seven-day pool: without this, the same repository would be
 * recommended every day for a week.
 *
 * Fingerprints are pruned by age. A permanent index would eventually suppress a
 * project that genuinely deserves a second mention a year later.
 */

import path from "node:path";
import { readJson, writeJsonAtomic } from "./json-store.js";

export const HISTORY_FILE = "seen-fingerprints.json";
export const DEFAULT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days of suppression, bounded.
 *
 * A zero or negative retention would expire every fingerprint immediately and
 * quietly disable deduplication, which looks identical to it working.
 */
export function resolveRetentionDays(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_RETENTION_DAYS;
  return Math.min(365, Math.max(1, Math.round(number)));
}

export class RecommendationHistory {
  constructor(filePath, { retentionDays } = {}) {
    this.filePath = filePath;
    this.retentionDays = resolveRetentionDays(retentionDays);
  }

  static forDataPaths(dataPaths, options = {}) {
    return new RecommendationHistory(path.join(dataPaths.root, HISTORY_FILE), options);
  }

  async #read() {
    const document = await readJson(this.filePath, { version: 1, fingerprints: {} });
    return document?.fingerprints && typeof document.fingerprints === "object"
      ? document
      : { version: 1, fingerprints: {} };
  }

  /** Fingerprints still inside the retention window, as `prepareArticlePreview` expects. */
  async load(now = new Date()) {
    const { fingerprints } = await this.#read();
    const cutoff = now.getTime() - this.retentionDays * DAY_MS;
    const live = {};
    for (const [fingerprint, seenAt] of Object.entries(fingerprints)) {
      const stamp = Date.parse(seenAt);
      if (!Number.isFinite(stamp) || stamp >= cutoff) live[fingerprint] = seenAt;
    }
    return live;
  }

  /**
   * Record what was actually delivered. Call this only after delivery is
   * confirmed: recording a briefing that never reached anyone would suppress
   * those entries from the next run for nothing.
   */
  async record(items = [], now = new Date()) {
    const document = await this.#read();
    const seenAt = now.toISOString();
    let added = 0;
    for (const item of items) {
      if (!item?.fingerprint) continue;
      if (!(item.fingerprint in document.fingerprints)) added += 1;
      document.fingerprints[item.fingerprint] = seenAt;
    }
    const cutoff = now.getTime() - this.retentionDays * DAY_MS;
    let pruned = 0;
    for (const [fingerprint, stamp] of Object.entries(document.fingerprints)) {
      const parsed = Date.parse(stamp);
      if (Number.isFinite(parsed) && parsed < cutoff) {
        delete document.fingerprints[fingerprint];
        pruned += 1;
      }
    }
    await writeJsonAtomic(this.filePath, document);
    return { added, pruned, total: Object.keys(document.fingerprints).length };
  }
}

/** A history that remembers nothing, for callers that do not want local state. */
export const NULL_HISTORY = {
  async load() {
    return {};
  },
  async record() {
    return { added: 0, pruned: 0, total: 0 };
  },
};
