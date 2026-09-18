/**
 * Remember which cover images have already been uploaded to WeChat.
 *
 * Permanent material counts against the account's quota, and a draft creation
 * that fails after the cover upload succeeds leaves an orphan behind. Retrying
 * the same briefing would upload the same picture again, so the media_id is
 * cached against a hash of the exact bytes and reused.
 *
 * The cache is a convenience, never a source of truth: a stale entry surfaces
 * as WeChat rejecting the media_id, which drops the entry and re-uploads once.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { readJson, writeJsonAtomic } from "../storage/json-store.js";

export const COVER_CACHE_FILE = "wechat-cover-material.json";
const MAX_ENTRIES = 200;

export function hashCover(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export class CoverMaterialCache {
  /** @param {string} filePath Where the cache lives; usually under the Skill data directory. */
  constructor(filePath) {
    this.filePath = filePath;
  }

  static forDataPaths(dataPaths) {
    return new CoverMaterialCache(path.join(dataPaths.root, COVER_CACHE_FILE));
  }

  async #read() {
    const document = await readJson(this.filePath, { version: 1, entries: {} });
    return document && typeof document === "object" && document.entries ? document : { version: 1, entries: {} };
  }

  async lookup(hash) {
    const { entries } = await this.#read();
    const entry = entries[hash];
    return entry && typeof entry.mediaId === "string" ? entry.mediaId : null;
  }

  async remember(hash, mediaId, now = new Date()) {
    const document = await this.#read();
    document.entries[hash] = { mediaId, uploadedAt: now.toISOString() };
    // Keep the newest entries only; an unbounded cache would grow forever.
    const ordered = Object.entries(document.entries).sort(
      (left, right) => String(right[1].uploadedAt).localeCompare(String(left[1].uploadedAt)),
    );
    document.entries = Object.fromEntries(ordered.slice(0, MAX_ENTRIES));
    await writeJsonAtomic(this.filePath, document);
    return mediaId;
  }

  async forget(hash) {
    const document = await this.#read();
    if (!(hash in document.entries)) return false;
    delete document.entries[hash];
    await writeJsonAtomic(this.filePath, document);
    return true;
  }
}

/** A cache that keeps nothing, for callers that do not want local state. */
export const NULL_COVER_CACHE = {
  async lookup() {
    return null;
  },
  async remember(_hash, mediaId) {
    return mediaId;
  },
  async forget() {
    return false;
  },
};
