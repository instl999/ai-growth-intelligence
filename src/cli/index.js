import { readFile } from "node:fs/promises";
import { createClientAdapter, parseUserIntent } from "../clients/adapter.js";
import { buildDeliveryPlan } from "../core/delivery-plan.js";
import { createIntelligenceItem } from "../core/models.js";
import { ARTICLE_STYLES } from "../core/article-composer.js";
import { prepareArticlePreview } from "../core/preview-workflow.js";
import { getDataPaths } from "../storage/paths.js";
import { NULL_HISTORY, RecommendationHistory } from "../storage/recommendation-history.js";
import { getGitHubAutomationSafetyContract } from "../github/automation.js";
import { GitHubCommandError, redactGitHubSecrets, runGitHubCommandFromArgs } from "../github/command.js";
import { runWechatCommand } from "../wechat/command.js";

function parseFlags(args) {
  return {
    client: args.includes("--client") ? args[args.indexOf("--client") + 1] : "generic",
    capabilities: {
      hasWebSearch: args.includes("--web-search"),
      hasWebBrowse: args.includes("--web-browse"),
      canDiscoverInstallableSkills: args.includes("--skill-discovery"),
      hasMessageTool: args.includes("--message-tool"),
    },
  };
}

function usage() {
  return {
    usage: [
      "node src/cli/index.js capabilities --client openclaw --web-search --web-browse --message-tool",
      "node src/cli/index.js intent 生成今日情报",
      "node src/cli/index.js github-automation",
      "node src/cli/index.js github-scan --config config.json",
      "node src/cli/index.js github-run --config config.json --annotations annotations.json --mode dry_run",
      "node src/cli/index.js github-run --config config.json --annotations annotations.json --mode apply --acknowledge-risk",
      "node src/cli/index.js wechat-contract --config config.json",
      "node src/cli/index.js wechat-draft --config config.json --items items.json --mode dry_run",
      "node src/cli/index.js wechat-draft --config config.json --items items.json --mode apply --acknowledge-write",
      "node src/cli/index.js preview-article --config config.json --items items.json --markdown",
      "node src/cli/index.js preview-article --items items.json --style brief --markdown --no-history",
      "node src/cli/index.js delivery-plan --config config.json --items items.json",
      "node src/cli/index.js record-delivered --items items.json",
    ],
  };
}

export function runCli(args) {
  const [command, ...rest] = args;
  if (!command || ["help", "--help", "-h"].includes(command)) return usage();
  if (command === "capabilities") return createClientAdapter(parseFlags(rest));
  if (command === "intent") return parseUserIntent(rest.join(" "));
  if (command === "github-automation") return getGitHubAutomationSafetyContract();
  throw new GitHubCommandError(`Unsupported command: ${command}`, "unsupported_command");
}

async function readJsonArgument(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new GitHubCommandError(`${flag} requires a value.`, "missing_option_value");
  }
  try {
    return JSON.parse(await readFile(value, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new GitHubCommandError(`File not found: ${value}`, "file_not_found");
    throw new GitHubCommandError(`Not valid JSON: ${value}`, "invalid_json");
  }
}

async function loadItemsArgument(args, command) {
  const itemsDocument = await readJsonArgument(args, "--items");
  const rawItems = Array.isArray(itemsDocument) ? itemsDocument : itemsDocument?.items;
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw new GitHubCommandError(`${command} requires --items with a non-empty items array.`, "missing_items");
  }
  return rawItems.map(createIntelligenceItem);
}

function resolveHistory(args, dependencies, config = {}) {
  if (dependencies.history) return dependencies.history;
  if (args.includes("--no-history")) return NULL_HISTORY;
  // config.recommendationHistoryDays ships in config.example.json; before this
  // it was never passed through, so retention was always the 30-day default.
  return RecommendationHistory.forDataPaths(getDataPaths(dependencies.pathOptions ?? {}), {
    retentionDays: config?.recommendationHistoryDays,
  });
}

async function runDeliveryPlan(args, dependencies) {
  const config = (await readJsonArgument(args, "--config")) ?? {};
  const items = await loadItemsArgument(args, "delivery-plan");
  const now = dependencies.now ?? new Date();
  const history = resolveHistory(args, dependencies, config);
  // Suppress anything already recommended inside the retention window. This
  // matters most for the seven-day pooled sections, where the same repository
  // would otherwise reappear every day for a week.
  const seenFingerprints = await history.load(now);
  const preview = prepareArticlePreview({ items, seenFingerprints, config, now });
  const plan = buildDeliveryPlan({
    preview,
    config,
    capabilities: {
      hasMessageTool: args.includes("--message-tool") || Boolean(dependencies.capabilities?.hasMessageTool),
    },
  });
  return {
    ...plan,
    deduplication: {
      previouslyRecommended: Object.keys(seenFingerprints).length,
      suppressedThisRun: preview.duplicates.length,
    },
    sections: preview.article?.sections ?? [],
  };
}

function readStyleOverride(args) {
  if (!args.includes("--style")) return null;
  const value = args[args.indexOf("--style") + 1];
  if (!ARTICLE_STYLES.includes(value)) {
    throw new GitHubCommandError(`--style must be one of: ${ARTICLE_STYLES.join(", ")}.`, "invalid_style");
  }
  return value;
}

/**
 * Render a briefing exactly as it would be delivered, so the layout can be read
 * before anything is sent. Nothing here touches the network or the message tool.
 *
 * `--markdown` prints the article itself rather than a JSON envelope, because a
 * JSON-escaped briefing is unreadable and the point of this command is to look
 * at the formatting. `--style` compares the two layouts without editing config.
 */
async function runPreviewArticle(args, dependencies) {
  const config = (await readJsonArgument(args, "--config")) ?? {};
  const items = await loadItemsArgument(args, "preview-article");
  const now = dependencies.now ?? new Date();
  const style = readStyleOverride(args);
  const effectiveConfig = style ? { ...config, article: { ...config.article, style } } : config;
  // Same suppression the real run applies, so the preview is what would be sent.
  const seenFingerprints = await resolveHistory(args, dependencies, effectiveConfig).load(now);
  const preview = prepareArticlePreview({ items, seenFingerprints, config: effectiveConfig, now });
  const asMarkdown = args.includes("--markdown");

  if (preview.status !== "delivery_ready") {
    if (asMarkdown) return preview.reason;
    return { status: preview.status, reason: preview.reason, omittedItemCount: preview.omittedItems.length };
  }
  if (asMarkdown) return preview.article.markdown;
  return {
    status: preview.status,
    style: preview.article.style,
    title: preview.article.title,
    digest: preview.article.digest,
    markdown: preview.article.markdown,
    // Surfaced so a run that quietly fell back to fragment-assembled prose is
    // visible before the briefing goes out, not after someone reads it.
    entriesWithoutBody: preview.article.entriesWithoutBody,
    sections: preview.article.sections,
  };
}

async function runRecordDelivered(args, dependencies) {
  // Recording has to use the same retention the reading side uses, or entries
  // would be written under one window and pruned under another.
  const config = (await readJsonArgument(args, "--config")) ?? {};
  const items = await loadItemsArgument(args, "record-delivered");
  const now = dependencies.now ?? new Date();
  const result = await resolveHistory(args, dependencies, config).record(items, now);
  return { status: "recorded", ...result };
}

export async function runCliCommand(args, dependencies = {}) {
  const [command, ...rest] = args;
  if (command === "preview-article") return runPreviewArticle(rest, dependencies);
  if (command === "delivery-plan") return runDeliveryPlan(rest, dependencies);
  if (command === "record-delivered") return runRecordDelivered(rest, dependencies);
  if (["github-scan", "github-run"].includes(command)) return runGitHubCommandFromArgs(command, rest, dependencies);
  if (["wechat-contract", "wechat-draft"].includes(command)) return runWechatCommand(command, rest, dependencies);
  return runCli(args);
}

function serializeCliFailure(error) {
  return {
    status: "failed",
    error: {
      code: error?.code ?? "cli_error",
      message: redactGitHubSecrets(typeof error?.message === "string" ? error.message : "Command failed."),
    },
  };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("src/cli/index.js")) {
  try {
    const result = await runCliCommand(process.argv.slice(2));
    // A command may return ready-to-read text; only envelopes are serialized.
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    process.exitCode = 1;
    console.error(JSON.stringify(serializeCliFailure(error), null, 2));
  }
}
