/**
 * CLI wiring for the WeChat draft-box feature.
 *
 * Mirrors the GitHub automation commands: a read-only contract command, a
 * preview that never touches the network, and an apply that needs the feature
 * enabled, dryRun turned off, and an explicit per-run flag.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createIntelligenceItem } from "../core/models.js";
import { prepareArticlePreview } from "../core/preview-workflow.js";
import { getDataPaths } from "../storage/paths.js";
import { CoverMaterialCache } from "./cover-cache.js";
import { getWechatDraftSafetyContract, pushBriefingToWechatDraft } from "./draft.js";

export class WechatCommandError extends Error {
  constructor(message, code = "invalid_command") {
    super(message);
    this.name = "WechatCommandError";
    this.code = code;
  }
}

function parseMode(value) {
  const normalized = value === "dry-run" ? "dry_run" : value;
  if (!["dry_run", "apply"].includes(normalized)) throw new WechatCommandError("--mode must be dry_run or apply.", "invalid_mode");
  return normalized;
}

export function parseWechatCommandArgs(args = []) {
  const parsed = { mode: "dry_run", acknowledgeWrite: false };
  const valueFlags = new Map([
    ["--config", "configPath"],
    ["--article", "articlePath"],
    ["--items", "itemsPath"],
    ["--mode", "mode"],
    ["--cover-out", "coverOut"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--acknowledge-write") {
      if (parsed.acknowledgeWrite) throw new WechatCommandError(`Duplicate option: ${flag}`, "duplicate_option");
      parsed.acknowledgeWrite = true;
      continue;
    }
    const field = valueFlags.get(flag);
    if (!field) throw new WechatCommandError(`Unsupported option: ${flag}`, "unsupported_option");
    const value = args[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) throw new WechatCommandError(`${flag} requires a value.`, "missing_option_value");
    parsed[field] = field === "mode" ? parseMode(value) : value;
    index += 1;
  }
  return parsed;
}

async function readJsonFile(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new WechatCommandError(`${label} not found: ${filePath}`, "file_not_found");
    throw new WechatCommandError(`${label} is not valid JSON: ${filePath}`, "invalid_json");
  }
}

/**
 * Load the article: either a composed document, or items to compose from.
 */
async function loadArticle({ articlePath, itemsPath }, config = {}, now = new Date()) {
  if (articlePath) {
    const document = await readJsonFile(articlePath, "Article document");
    if (!document?.markdown || !document?.title) {
      throw new WechatCommandError("The article document needs title and markdown fields.", "invalid_article");
    }
    return document;
  }
  if (itemsPath) {
    const document = await readJsonFile(itemsPath, "Items document");
    const rawItems = Array.isArray(document) ? document : document?.items;
    if (!Array.isArray(rawItems) || !rawItems.length) {
      throw new WechatCommandError("The items document must contain a non-empty items array.", "invalid_items");
    }
    // Route raw items through the same assessment and section-minimum pipeline
    // the briefing itself uses, so a WeChat draft can never carry content the
    // briefing would have rejected.
    //
    // The config has to come with them. Without it this composed the draft under
    // defaults while the briefing used the operator's settings, so a configured
    // article.style, section window, minimum or cap silently did not apply to
    // the draft — the one output where layout matters most.
    const preview = prepareArticlePreview({ items: rawItems.map(createIntelligenceItem), config, now });
    if (preview.status !== "delivery_ready") {
      throw new WechatCommandError(preview.reason ?? "No section reached the minimum item count.", "no_publishable_article");
    }
    return preview.article;
  }
  throw new WechatCommandError("Provide --article or --items.", "missing_article");
}

export async function runWechatCommand(command, args = [], dependencies = {}) {
  if (command === "wechat-contract") {
    const parsed = parseWechatCommandArgs(args);
    const config = parsed.configPath ? await readJsonFile(parsed.configPath, "Configuration document") : {};
    return getWechatDraftSafetyContract(config);
  }
  if (command !== "wechat-draft") throw new WechatCommandError(`Unsupported command: ${command}`, "unsupported_command");

  const parsed = parseWechatCommandArgs(args);
  const config = parsed.configPath ? await readJsonFile(parsed.configPath, "Configuration document") : {};
  // One clock for the whole command. The draft already honoured an injected
  // `now` while composition silently read the real one, so the two halves of a
  // single run could disagree about which items were still inside their window.
  const now = dependencies.now ?? new Date();
  const article = await loadArticle(parsed, config, now);

  // A live write needs the per-run flag as well as the stored configuration.
  if (parsed.mode === "apply" && !parsed.acknowledgeWrite) {
    return {
      status: "blocked",
      reason: "write_acknowledgement_required",
      written: false,
      hint: "Re-run with --acknowledge-write to create the draft.",
    };
  }

  const dataPaths = getDataPaths(dependencies.pathOptions ?? {});
  const coverOut = parsed.coverOut ?? path.join(dataPaths.articles, "wechat-cover-preview.png");

  return pushBriefingToWechatDraft({
    article,
    config,
    mode: parsed.mode,
    env: dependencies.env ?? process.env,
    clientFactory: dependencies.clientFactory,
    coverCache: dependencies.coverCache ?? CoverMaterialCache.forDataPaths(dataPaths),
    now,
    saveCover: dependencies.saveCover ?? (async (bytes, suggestedName) => {
      const target = coverOut.endsWith(".png") ? coverOut : path.join(coverOut, suggestedName);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return target;
    }),
  });
}
