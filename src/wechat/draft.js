/**
 * Optional feature: push a finished briefing into the WeChat Official Account
 * draft box, with a generated cover.
 *
 * Shape of the guarantee: the widest thing this can do is leave a draft for a
 * person to review. It never publishes, never mass-sends, and never schedules.
 * It is disabled by default, previews by default once enabled, and reads its
 * credentials only from the host environment.
 */

import { renderCover } from "./cover.js";
import { buildDigest, buildTitle, markdownToWechatHtml } from "./html.js";
import { WechatApiError, WechatDraftClient, redactWechatSecrets } from "./api-client.js";
import { NULL_COVER_CACHE, hashCover } from "./cover-cache.js";

export const WECHAT_CREDENTIAL_VARIABLES = Object.freeze(["WECHAT_APP_ID", "WECHAT_APP_SECRET"]);

/** WeChat rejects a draft whose content field exceeds this many characters. */
export const MAX_CONTENT_LENGTH = 20_000;

/** WeChat error codes meaning "that media_id is not usable". */
export const STALE_MEDIA_ERRCODES = new Set([40007, 40118, 41005]);

function isStaleMediaError(error) {
  return error instanceof WechatApiError && STALE_MEDIA_ERRCODES.has(Number(error.details?.errcode));
}

export const DEFAULT_WECHAT_DRAFT_CONFIG = Object.freeze({
  enabled: false,
  dryRun: true,
  author: "",
  sourceUrl: "",
  linkStyle: "text",
  openComment: false,
  onlyFansCanComment: false,
  coverWordmark: "AI GROWTH INTELLIGENCE",
  footer: "",
});

const LINK_STYLES = new Set(["text", "anchor"]);
// Anything that looks like it is trying to smuggle a credential through config.
const CREDENTIAL_KEY_PATTERN = /secret|token|appsecret|password|credential/iu;

function draftError(message, code) {
  return Object.assign(new Error(message), { code });
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw draftError(`${field} must be a string.`, "invalid_config");
  const trimmed = value.trim();
  if (maxLength && trimmed.length > maxLength) throw draftError(`${field} must be at most ${maxLength} characters.`, "invalid_config");
  return trimmed;
}

/** Reject a config document that carries credential material. */
export function assertNoCredentialsInConfig(document, path = "wechatDraftBox") {
  if (!document || typeof document !== "object") return;
  for (const [key, value] of Object.entries(document)) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) {
      throw draftError(
        `${path}.${key} must not appear in a configuration file. Supply ${WECHAT_CREDENTIAL_VARIABLES.join(" and ")} through the environment instead.`,
        "credentials_in_config",
      );
    }
    if (value && typeof value === "object") assertNoCredentialsInConfig(value, `${path}.${key}`);
  }
}

export function normalizeWechatDraftConfig(config = {}) {
  const section = config?.wechatDraftBox ?? config ?? {};
  assertNoCredentialsInConfig(section);
  const linkStyle = section.linkStyle ?? DEFAULT_WECHAT_DRAFT_CONFIG.linkStyle;
  if (!LINK_STYLES.has(linkStyle)) throw draftError("wechatDraftBox.linkStyle must be \"text\" or \"anchor\".", "invalid_config");
  const sourceUrl = optionalString(section.sourceUrl, "wechatDraftBox.sourceUrl", 512);
  if (sourceUrl && !/^https?:\/\//u.test(sourceUrl)) throw draftError("wechatDraftBox.sourceUrl must be an http(s) URL.", "invalid_config");
  return {
    enabled: section.enabled === true,
    dryRun: section.dryRun !== false,
    author: optionalString(section.author, "wechatDraftBox.author", 8),
    sourceUrl,
    linkStyle,
    openComment: section.openComment === true,
    onlyFansCanComment: section.onlyFansCanComment === true,
    coverWordmark: optionalString(section.coverWordmark, "wechatDraftBox.coverWordmark", 48) || DEFAULT_WECHAT_DRAFT_CONFIG.coverWordmark,
    footer: optionalString(section.footer, "wechatDraftBox.footer", 200),
  };
}

/** The read-only description of what this feature may and may not do. */
export function getWechatDraftSafetyContract(config = {}) {
  const normalized = normalizeWechatDraftConfig(config);
  return {
    feature: "wechat_official_account_draft_box",
    enabled: normalized.enabled,
    dryRunDefault: true,
    credentialsFrom: [...WECHAT_CREDENTIAL_VARIABLES],
    credentialsInConfig: "rejected",
    allowedOperations: ["cgi-bin/token", "cgi-bin/material/add_material?type=image", "cgi-bin/draft/add"],
    forbiddenOperations: [
      "publishing an article",
      "mass sending to followers",
      "scheduled or timed sending",
      "deleting existing drafts or material",
      "changing account settings",
    ],
    coverImage: "generated locally, deterministic per briefing, no external image service",
    limits: { titleCharacters: 64, digestCharacters: 120, contentCharacters: MAX_CONTENT_LENGTH },
    humanStepRequired: "A person must open the draft box and publish by hand.",
  };
}

export function resolveWechatCredentials(env = process.env) {
  const appId = typeof env.WECHAT_APP_ID === "string" ? env.WECHAT_APP_ID.trim() : "";
  const appSecret = typeof env.WECHAT_APP_SECRET === "string" ? env.WECHAT_APP_SECRET.trim() : "";
  const missing = WECHAT_CREDENTIAL_VARIABLES.filter((name) => !String(env[name] ?? "").trim());
  return { appId, appSecret, missing, available: missing.length === 0 };
}

/** Latin section labels for the cover, derived from the briefing's own sections. */
export function coverTagsFromMarkdown(markdown) {
  const map = new Map([
    ["GitHub 精选", "GITHUB"],
    ["AI 情报", "AI"],
    ["Skill 精选", "SKILL"],
    ["综合情报", "GROWTH"],
  ]);
  // Match the label anywhere in an h2 rather than requiring it to follow "## "
  // directly, so decorating a section heading cannot silently produce a cover
  // with no tags at all.
  const headings = markdown.split(/\r?\n/u).filter((line) => line.startsWith("## "));
  const tags = [];
  for (const [label, tag] of map) if (headings.some((heading) => heading.includes(label))) tags.push(tag);
  return tags;
}

function dateLabel(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts.replaceAll("-", ".");
}

/**
 * Build everything that would be sent, without contacting WeChat.
 * @returns {{title, digest, html, cover, article}} `article` lacks thumb_media_id until upload.
 */
export function prepareWechatDraft({ article, config = {}, now = new Date() } = {}) {
  if (!article?.markdown || !article?.title) throw draftError("A composed article with a title and markdown is required.", "invalid_article");
  const normalized = normalizeWechatDraftConfig(config);
  const title = buildTitle(article.title);
  const digest = buildDigest(article.digest ?? article.title);
  const html = markdownToWechatHtml(article.markdown, { linkStyle: normalized.linkStyle, footer: normalized.footer, style: article.style });
  const label = dateLabel(now);
  const cover = renderCover({
    seed: `${label}|${article.title}`,
    wordmark: normalized.coverWordmark,
    dateLabel: label,
    tags: coverTagsFromMarkdown(article.markdown),
  });
  // Fail loudly rather than truncate: a silently shortened briefing would drop
  // entries and their sources, which is worse than not creating the draft.
  if (html.length > MAX_CONTENT_LENGTH) {
    throw draftError(
      `The rendered article is ${html.length} characters, over WeChat's ${MAX_CONTENT_LENGTH} limit by ${html.length - MAX_CONTENT_LENGTH}. `
        + "Reduce the number of entries, or set linkStyle to \"anchor\" so source URLs are not repeated as visible text.",
      "content_too_long",
    );
  }

  return {
    config: normalized,
    title,
    digest,
    html,
    cover,
    contentLength: html.length,
    article: {
      title,
      author: normalized.author || undefined,
      digest,
      content: html,
      content_source_url: normalized.sourceUrl || undefined,
      need_open_comment: normalized.openComment ? 1 : 0,
      only_fans_can_comment: normalized.onlyFansCanComment ? 1 : 0,
    },
  };
}

/**
 * Preview or create a WeChat draft.
 *
 * @param {object} options
 * @param {object} options.article       Output of composeArticle().
 * @param {object} options.config        Full config document or the wechatDraftBox section.
 * @param {"dry_run"|"apply"} options.mode
 * @param {object} [options.env]         Where credentials are read from.
 * @param {Function} [options.clientFactory]
 * @param {Function} [options.saveCover] async (bytes, suggestedName) => string path, for dry runs.
 */
export async function pushBriefingToWechatDraft({
  article,
  config = {},
  mode = "dry_run",
  env = process.env,
  clientFactory,
  saveCover,
  coverCache,
  now = new Date(),
} = {}) {
  const normalized = normalizeWechatDraftConfig(config);
  if (!normalized.enabled) {
    return { status: "disabled", reason: "wechat_draft_box_disabled", written: false };
  }
  if (!["dry_run", "apply"].includes(mode)) throw draftError("mode must be dry_run or apply.", "invalid_mode");
  const wantsApply = mode === "apply";
  if (wantsApply && normalized.dryRun) {
    return { status: "blocked", reason: "dry_run_locked_in_config", written: false };
  }

  const prepared = prepareWechatDraft({ article, config, now });
  const summary = {
    title: prepared.title,
    digest: prepared.digest,
    contentLength: prepared.contentLength,
    coverBytes: prepared.cover.png.length,
    coverPalette: prepared.cover.palette.name,
    linkStyle: normalized.linkStyle,
  };

  if (!wantsApply) {
    const coverPath = typeof saveCover === "function"
      ? await saveCover(prepared.cover.png, `wechat-cover-${dateLabel(now).replaceAll(".", "")}.png`)
      : null;
    return { status: "dry_run", written: false, ...summary, coverPath, html: prepared.html };
  }

  const credentials = resolveWechatCredentials(env);
  if (!credentials.available) {
    return { status: "blocked", reason: "missing_credentials", missing: credentials.missing, written: false, ...summary };
  }

  const client = typeof clientFactory === "function"
    ? clientFactory({ appId: credentials.appId, appSecret: credentials.appSecret })
    : new WechatDraftClient({ appId: credentials.appId, appSecret: credentials.appSecret });

  const cache = coverCache ?? NULL_COVER_CACHE;
  const coverHash = hashCover(prepared.cover.png);
  let coverMediaId = null;
  let coverReused = false;

  const uploadCover = async () => {
    const uploaded = await client.uploadPermanentImage(prepared.cover.png, "cover.png");
    await cache.remember(coverHash, uploaded.mediaId, now);
    return uploaded.mediaId;
  };

  try {
    // Reuse an identical cover already in the account's permanent material
    // rather than spending another slot of a limited quota on a retry.
    const cached = await cache.lookup(coverHash);
    if (cached) {
      coverMediaId = cached;
      coverReused = true;
    } else {
      coverMediaId = await uploadCover();
    }

    let draft;
    try {
      draft = await client.addDraft({ ...prepared.article, thumb_media_id: coverMediaId });
    } catch (error) {
      // A cached media_id can be deleted in the console behind our back. Drop
      // the entry, upload once more, and try the draft again.
      if (!coverReused || !isStaleMediaError(error)) throw error;
      await cache.forget(coverHash);
      coverReused = false;
      coverMediaId = await uploadCover();
      draft = await client.addDraft({ ...prepared.article, thumb_media_id: coverMediaId });
    }

    return {
      status: "created",
      written: true,
      draftMediaId: draft.mediaId,
      coverMediaId,
      coverReused,
      ...summary,
      nextStep: "Open the account's draft box, review the article, and publish it by hand.",
    };
  } catch (error) {
    const secrets = [credentials.appSecret];
    return {
      status: "failed",
      written: coverMediaId !== null && !coverReused,
      coverMediaId,
      coverReused,
      ...summary,
      error: {
        code: error instanceof WechatApiError ? error.code : error?.code ?? "wechat_push_failed",
        message: redactWechatSecrets(error?.message ?? "WeChat draft creation failed.", ...secrets),
      },
    };
  }
}
