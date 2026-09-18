import { readFile } from "node:fs/promises";
import { createGitHubApiClient } from "./api-client.js";
import { runGitHubAutoForkAndOrganize, scanHotGitHubRepositories } from "./automation.js";
import { normalizeGitHubAutomationConfig, repositoryKey, sanitizeRepository } from "./metadata.js";

const SECRET_PATTERN = /(?:github_pat_|gh[pousrue]_)[A-Za-z0-9_]{8,}/gu;
const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "token",
  "githubtoken",
  "github_token",
  "authorization",
  "password",
  "secret",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
]);

export class GitHubCommandError extends Error {
  constructor(message, code = "invalid_command") {
    super(message);
    this.name = "GitHubCommandError";
    this.code = code;
  }
}

export function redactGitHubSecrets(value) {
  return String(value ?? "Command failed.").replace(SECRET_PATTERN, "[REDACTED]");
}

function rejectCredentialMaterial(value, path = "document") {
  if (typeof value === "string") {
    SECRET_PATTERN.lastIndex = 0;
    if (SECRET_PATTERN.test(value)) throw new GitHubCommandError(`${path} contains credential-shaped material.`, "credential_material_forbidden");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectCredentialMaterial(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[\s-]/gu, "");
    if (FORBIDDEN_CREDENTIAL_KEYS.has(key.toLowerCase()) || FORBIDDEN_CREDENTIAL_KEYS.has(normalizedKey)) {
      throw new GitHubCommandError(`${path} must not contain credential fields.`, "credential_field_forbidden");
    }
    rejectCredentialMaterial(child, `${path}.${key}`);
  }
}

function parseMode(value) {
  const normalized = value === "dry-run" ? "dry_run" : value;
  if (!["dry_run", "apply"].includes(normalized)) throw new GitHubCommandError("--mode must be dry_run or apply.", "invalid_mode");
  return normalized;
}

export function parseGitHubCommandArgs(args = []) {
  const parsed = { acknowledgeRisk: false };
  const valueFlags = new Map([
    ["--config", "configPath"],
    ["--annotations", "annotationsPath"],
    ["--mode", "mode"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--acknowledge-risk") {
      if (parsed.acknowledgeRisk) throw new GitHubCommandError(`Duplicate option: ${flag}`, "duplicate_option");
      parsed.acknowledgeRisk = true;
      continue;
    }
    const field = valueFlags.get(flag);
    if (!field) throw new GitHubCommandError(`Unknown option: ${flag}`, "unknown_option");
    if (parsed[field] !== undefined) throw new GitHubCommandError(`Duplicate option: ${flag}`, "duplicate_option");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new GitHubCommandError(`${flag} requires a value.`, "missing_option_value");
    parsed[field] = value;
    index += 1;
  }
  if (parsed.mode !== undefined) parsed.mode = parseMode(parsed.mode);
  return parsed;
}

function selectConfig(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new GitHubCommandError("Configuration JSON must be an object.", "invalid_config_document");
  rejectCredentialMaterial(document, "config");
  return normalizeGitHubAutomationConfig(document.githubAutoForkAndOrganize ?? document);
}

function createAnnotationProvider(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new GitHubCommandError("Annotations JSON must be an object keyed by owner/repository.", "invalid_annotations_document");
  }
  rejectCredentialMaterial(document, "annotations");
  const normalized = new Map();
  for (const [rawKey, annotation] of Object.entries(document)) {
    if (rawKey !== rawKey.trim() || rawKey !== rawKey.toLowerCase()) {
      throw new GitHubCommandError(`Annotation key must already be lowercase owner/repository: ${rawKey}`, "invalid_annotation_key");
    }
    try {
      repositoryKey({ full_name: rawKey });
    } catch {
      throw new GitHubCommandError(`Invalid annotation repository key: ${rawKey}`, "invalid_annotation_key");
    }
    if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) {
      throw new GitHubCommandError(`Annotation for ${rawKey} must be an object.`, "invalid_annotation");
    }
    const unexpected = Object.keys(annotation).filter((key) => !["chineseSummary", "englishTags"].includes(key));
    if (unexpected.length) throw new GitHubCommandError(`Annotation for ${rawKey} contains unsupported fields.`, "invalid_annotation_fields");
    if (normalized.has(rawKey)) throw new GitHubCommandError(`Duplicate annotation key: ${rawKey}`, "duplicate_annotation_key");
    normalized.set(rawKey, annotation);
  }
  return async ({ repository }) => {
    const key = repositoryKey(repository);
    const annotation = normalized.get(key);
    if (!annotation) throw new GitHubCommandError(`Missing annotation for ${key}.`, "missing_annotation");
    return { chineseSummary: annotation.chineseSummary, englishTags: annotation.englishTags };
  };
}

export async function runGitHubAutomationCommand({
  command,
  configDocument,
  annotationsDocument,
  mode,
  acknowledgeRisk = false,
  client,
  clientFactory = createGitHubApiClient,
  now = new Date(),
  logger,
  forkWaitAttempts,
  forkWaitDelayMs,
} = {}) {
  const config = selectConfig(configDocument);
  if (!config.enabled) return { status: "disabled", writePerformed: false, writeAttempted: false, writeMayHaveOccurred: false, writeOutcome: "none", reason: "feature_disabled" };

  if (command === "github-scan") {
    const scanClient = client ?? clientFactory({ token: null });
    const scanned = await scanHotGitHubRepositories({ client: scanClient, config, now });
    return {
      status: scanned.repositories.length ? "scanned" : "no_candidates",
      mode: "scan",
      writePerformed: false,
      writeAttempted: false,
      writeMayHaveOccurred: false,
      writeOutcome: "none",
      scanned: scanned.rawCount,
      queryResults: scanned.queries,
      candidates: scanned.repositories.map(sanitizeRepository),
      exclusions: scanned.excluded,
    };
  }

  if (command !== "github-run") throw new GitHubCommandError(`Unsupported GitHub command: ${command}`, "unsupported_command");
  const runMode = parseMode(mode);
  if (runMode === "apply" && (!config.riskAcknowledged || acknowledgeRisk !== true)) {
    return {
      status: "blocked",
      reason: "risk_acknowledgement_required",
      writePerformed: false,
      writeAttempted: false,
      writeMayHaveOccurred: false,
      writeOutcome: "none",
      required: ["config.riskAcknowledged=true", "--acknowledge-risk"],
    };
  }
  const annotateRepository = createAnnotationProvider(annotationsDocument);
  const runClient = client ?? clientFactory();
  return runGitHubAutoForkAndOrganize({
    client: runClient,
    config,
    mode: runMode,
    now,
    annotateRepository,
    riskAcknowledged: runMode === "apply" ? acknowledgeRisk : false,
    logger,
    forkWaitAttempts,
    forkWaitDelayMs,
  });
}

async function readJson(filePath, label) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new GitHubCommandError(`${label} path is required.`, `missing_${label}_path`);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw new GitHubCommandError(`Unable to read ${label} JSON file.`, `${label}_read_failed`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new GitHubCommandError(`${label} file is not valid JSON.`, `${label}_json_invalid`);
  }
}

export async function runGitHubCommandFromArgs(command, args, dependencies = {}) {
  const parsed = parseGitHubCommandArgs(args);
  const configDocument = await readJson(parsed.configPath, "config");
  if (command === "github-scan") {
    if (parsed.annotationsPath || parsed.mode || parsed.acknowledgeRisk) throw new GitHubCommandError("github-scan accepts only --config.", "scan_option_not_allowed");
    return runGitHubAutomationCommand({ ...dependencies, command, configDocument });
  }
  if (command === "github-run") {
    if (!parsed.mode) throw new GitHubCommandError("github-run requires --mode dry_run|apply.", "missing_mode");
    const annotationsDocument = await readJson(parsed.annotationsPath, "annotations");
    return runGitHubAutomationCommand({
      ...dependencies,
      command,
      configDocument,
      annotationsDocument,
      mode: parsed.mode,
      acknowledgeRisk: parsed.acknowledgeRisk,
    });
  }
  throw new GitHubCommandError(`Unsupported GitHub command: ${command}`, "unsupported_command");
}
