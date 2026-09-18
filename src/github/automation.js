import { createGitHubApiClient } from "./api-client.js";
import {
  GITHUB_AUTOMATION_NAME,
  GITHUB_SCAN_MAX_CANDIDATES,
  GITHUB_SCAN_MAX_FORKS_PER_RUN,
  GITHUB_SCAN_MAX_QUERIES,
  GITHUB_TOKEN_ENV_VAR,
  buildHotRepositoryQueries,
  evaluateHotRepositories,
  normalizeGitHubAutomationConfig,
  prepareRepositoryMetadata,
  repositoryKey,
  sanitizeRepository,
} from "./metadata.js";

const APPLY_CAPABILITIES = [
  "searchRepositories",
  "getAuthenticatedUser",
  "listOwnedRepositories",
  "getRepository",
  "getRepositoryTopics",
  "createFork",
  "waitForRepository",
  "updateRepository",
  "replaceRepositoryTopics",
];

function splitRepositoryName(repository) {
  const [owner, repo] = repositoryKey(repository).split("/");
  return { owner, repo };
}

function hasToken(client) {
  if (typeof client?.hasAuthentication === "function") return client.hasAuthentication() === true;
  return Boolean(client?.token);
}

function redactTokens(value, secret = null) {
  let output = String(value ?? "Unknown GitHub automation error.");
  if (secret) output = output.replaceAll(secret, "[REDACTED]");
  return output.replace(/(?:github_pat_|gh[pousrue]_)[A-Za-z0-9_]{8,}/gu, "[REDACTED]");
}

function serializeError(error, secret = null) {
  return {
    code: error?.code ?? "automation_error",
    message: redactTokens(error?.message, secret),
    status: Number.isInteger(error?.status) ? error.status : null,
    retryAfter: error?.retryAfter ?? null,
  };
}

function automationError(message, code) {
  return Object.assign(new Error(message), { code });
}

function ownedForkSourceKey(repository) {
  return repository?.parent?.full_name?.toLowerCase() ?? repository?.source?.full_name?.toLowerCase() ?? null;
}

function findExistingFork(ownedRepositories, source) {
  const sourceKey = repositoryKey(source);
  return ownedRepositories.find((repository) => ownedForkSourceKey(repository) === sourceKey) ?? null;
}

function targetFromFork(fork, fallbackOwner, fallbackRepo) {
  const owner = fork?.owner?.login ?? fallbackOwner;
  const repo = fork?.name ?? fallbackRepo;
  if (typeof owner !== "string" || !owner.trim() || typeof repo !== "string" || !repo.trim()) {
    throw automationError("Fork response did not include a resolvable personal repository target.", "fork_target_missing");
  }
  return { owner: owner.trim(), repo: repo.trim(), htmlUrl: fork?.html_url ?? `https://github.com/${owner}/${repo}` };
}

function requirePersonalTarget(target, personalOwner) {
  if (target.owner.toLowerCase() !== personalOwner.toLowerCase()) {
    throw automationError("Fork target owner does not match the authenticated personal owner.", "fork_owner_mismatch");
  }
  return target;
}

function blockedResult(reason, details = {}) {
  return {
    status: "blocked",
    writePerformed: false,
    writeAttempted: false,
    writeMayHaveOccurred: false,
    writeOutcome: "none",
    reason,
    ...details,
  };
}

function missingCapabilities(client) {
  return APPLY_CAPABILITIES.filter((method) => typeof client?.[method] !== "function");
}

function isDefinitiveRejection(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && error.status !== 408;
}

function operationOutcome(operations, failed = false) {
  const confirmed = operations.some((operation) => operation.status === "confirmed");
  const unknown = operations.some((operation) => operation.status === "unknown");
  if (confirmed && (unknown || failed)) return "partial";
  if (unknown) return "unknown";
  if (confirmed) return "confirmed";
  return "none";
}

function operationFlags(operations) {
  return {
    writeAttempted: operations.length > 0,
    writePerformed: operations.some((operation) => operation.status === "confirmed"),
    writeMayHaveOccurred: operations.some((operation) => ["confirmed", "unknown"].includes(operation.status)),
  };
}

async function logSafely(logger, event, warnings) {
  try {
    await logger(event);
  } catch (error) {
    warnings.push({ code: "logger_failed", message: redactTokens(error?.message ?? "Logger failed.") });
  }
}

async function mutate({ operations, operation, target, callback, emit }) {
  const entry = { operation, target, status: "started" };
  operations.push(entry);
  await emit({ type: "operation", ...entry });
  try {
    const result = await callback();
    entry.status = "confirmed";
    await emit({ type: "operation", ...entry });
    return result;
  } catch (error) {
    entry.status = isDefinitiveRejection(error) ? "rejected" : "unknown";
    await emit({ type: "operation", ...entry });
    throw error;
  }
}

function requireTopicNames(result) {
  if (!Array.isArray(result?.names)) throw automationError("GitHub returned an invalid repository topics response.", "invalid_topics_response");
  return result.names;
}

export async function scanHotGitHubRepositories({ client, config = {}, now = new Date() } = {}) {
  if (!client || typeof client.searchRepositories !== "function") throw new TypeError("A GitHub API client is required.");
  const normalized = normalizeGitHubAutomationConfig(config);
  const queries = buildHotRepositoryQueries({ scan: normalized.scan, now });
  const rawRepositories = [];
  const queryResults = [];
  for (const search of queries) {
    const result = await client.searchRepositories(search);
    if (!Array.isArray(result?.items)) throw automationError("GitHub returned an invalid repository search response.", "invalid_search_response");
    const items = result.items;
    rawRepositories.push(...items);
    queryResults.push({ term: search.term, totalCount: Number(result?.total_count ?? items.length), returned: items.length });
  }
  const evaluated = evaluateHotRepositories(rawRepositories, { scan: normalized.scan, now });
  return { queries: queryResults, rawCount: rawRepositories.length, repositories: evaluated.repositories, excluded: evaluated.excluded };
}

async function annotate(repository, annotateRepository) {
  if (typeof annotateRepository !== "function") throw new TypeError("annotateRepository is required to generate Chinese summary and English tags.");
  return annotateRepository({
    repository,
    evidence: {
      sourceUrl: repository.html_url,
      description: repository.description ?? "",
      topics: repository.topics ?? [],
      language: repository.language ?? null,
      license: repository.license?.spdx_id ?? repository.license?.key ?? null,
      pushedAt: repository.pushed_at ?? null,
      updatedAt: repository.updated_at ?? null,
    },
  });
}

async function authoritativeTopics({ client, source, existingFork }) {
  if (typeof client.getRepositoryTopics !== "function") throw automationError("Client cannot read repository topics.", "client_capability_missing");
  if (existingFork) {
    const target = targetFromFork(existingFork, existingFork.owner?.login, existingFork.name);
    return requireTopicNames(await client.getRepositoryTopics(target.owner, target.repo, { requiresAuth: true }));
  }
  const sourceParts = splitRepositoryName(source);
  return requireTopicNames(await client.getRepositoryTopics(sourceParts.owner, sourceParts.repo, { requiresAuth: false }));
}

async function organizeOne({ client, source, existingFork, annotation, initialMetadata, owner, maxTopics, options, operations, emit }) {
  const sourceParts = splitRepositoryName(source);
  let target = existingFork ? requirePersonalTarget(targetFromFork(existingFork, owner, sourceParts.repo), owner) : null;
  let createdFork = false;
  if (!target) {
    const sourceName = `${sourceParts.owner}/${sourceParts.repo}`;
    const fork = await mutate({
      operations,
      operation: "create_fork",
      target: sourceName,
      callback: () => client.createFork(sourceParts.owner, sourceParts.repo, {}),
      emit,
    });
    target = requirePersonalTarget(targetFromFork(fork, owner, sourceParts.repo), owner);
    createdFork = true;
    await client.waitForRepository(target.owner, target.repo, {
      attempts: options.forkWaitAttempts,
      delayMs: options.forkWaitDelayMs,
    });
  }

  const targetName = `${target.owner}/${target.repo}`;
  const currentTargetTopics = requireTopicNames(await client.getRepositoryTopics(target.owner, target.repo, { requiresAuth: true }));
  const finalMetadata = prepareRepositoryMetadata({ ...source, topics: currentTargetTopics }, {
    chineseSummary: annotation?.chineseSummary,
    englishTags: annotation?.englishTags ?? annotation?.tags,
    maxTopics,
  });
  await mutate({
    operations,
    operation: "update_description",
    target: targetName,
    callback: () => client.updateRepository(target.owner, target.repo, { description: finalMetadata.description }),
    emit,
  });
  await mutate({
    operations,
    operation: "replace_topics",
    target: targetName,
    callback: () => client.replaceRepositoryTopics(target.owner, target.repo, finalMetadata.topics),
    emit,
  });
  return {
    status: createdFork ? "organized" : "organized_existing_fork",
    source: sanitizeRepository(source),
    target: { fullName: targetName, htmlUrl: target.htmlUrl },
    topics: finalMetadata.topics,
    createdFork,
    ...operationFlags(operations),
    writeOutcome: operationOutcome(operations),
    operations,
    metadata: { description: finalMetadata.description, topics: finalMetadata.topics },
    preflightMetadata: { description: initialMetadata.description, topics: initialMetadata.topics },
  };
}

async function resolveOwnerAndRepositories(client, { required, warnings }) {
  try {
    const authenticatedUser = await client.getAuthenticatedUser();
    const owner = typeof authenticatedUser?.login === "string" && authenticatedUser.login.trim() ? authenticatedUser.login.trim() : null;
    if (!owner) throw automationError("Authenticated GitHub response did not include a personal owner login.", "authenticated_owner_missing");
    if (authenticatedUser?.type !== "User") {
      throw automationError("GitHub automation requires a personal User account.", "personal_owner_required");
    }
    const listed = await client.listOwnedRepositories();
    if (!Array.isArray(listed)) throw automationError("Client returned an invalid owned-repository list.", "invalid_owned_repository_list");
    const repositories = [];
    for (const repository of listed) {
      if (repository?.fork === true && !ownedForkSourceKey(repository)) {
        const repoOwner = repository?.owner?.login;
        const repoName = repository?.name;
        if (typeof repoOwner !== "string" || typeof repoName !== "string") {
          throw automationError("Owned Fork entry is missing owner/name.", "invalid_owned_fork");
        }
        repositories.push(await client.getRepository(repoOwner, repoName, { requiresAuth: true }));
      } else {
        repositories.push(repository);
      }
    }
    return { owner, repositories };
  } catch (error) {
    if (required) throw error;
    warnings.push({ code: "optional_authentication_failed", error: serializeError(error, client?.token) });
    return { owner: null, repositories: [] };
  }
}

export async function runGitHubAutoForkAndOrganize(options = {}) {
  const {
    client: suppliedClient = null,
    config = {},
    mode,
    now = new Date(),
    annotateRepository,
    riskAcknowledged = false,
    forkWaitAttempts = 6,
    forkWaitDelayMs = 1_000,
    logger = () => {},
  } = options;
  const normalized = normalizeGitHubAutomationConfig(config);
  const runMode = mode === "dry-run" ? "dry_run" : mode ?? "dry_run";
  if (!normalized.enabled) return { ...blockedResult("feature_disabled"), status: "disabled" };
  if (!["dry_run", "apply"].includes(runMode)) throw new TypeError("mode must be dry_run or apply.");
  if (!Number.isSafeInteger(forkWaitAttempts) || forkWaitAttempts <= 0) throw new TypeError("forkWaitAttempts must be a positive safe integer.");
  if (!Number.isSafeInteger(forkWaitDelayMs) || forkWaitDelayMs < 0) throw new TypeError("forkWaitDelayMs must be a non-negative safe integer.");
  if (runMode === "apply" && !(normalized.riskAcknowledged && riskAcknowledged === true)) return blockedResult("risk_acknowledgement_required");

  const client = suppliedClient ?? createGitHubApiClient();
  if (runMode === "apply" && !hasToken(client)) return blockedResult(`missing_${GITHUB_TOKEN_ENV_VAR.toLowerCase()}`);
  if (runMode === "apply") {
    const missing = missingCapabilities(client);
    if (missing.length) return blockedResult("client_capability_missing", { missingCapabilities: missing });
  }

  const warnings = [];
  const emit = (event) => logSafely(logger, event, warnings);
  let owner = null;
  let ownedRepositories = [];
  if (runMode === "apply" || hasToken(client)) {
    try {
      ({ owner, repositories: ownedRepositories } = await resolveOwnerAndRepositories(client, { required: runMode === "apply", warnings }));
    } catch (error) {
      return {
        status: "failed",
        stage: "authentication",
        mode: runMode,
        writePerformed: false,
        writeAttempted: false,
        writeMayHaveOccurred: false,
        writeOutcome: "none",
        warnings,
        error: serializeError(error, client?.token),
      };
    }
  }

  let scanned;
  try {
    scanned = await scanHotGitHubRepositories({ client, config: normalized, now });
  } catch (error) {
    return {
      status: "failed",
      stage: "scan",
      mode: runMode,
      owner,
      writePerformed: false,
      writeAttempted: false,
      writeMayHaveOccurred: false,
      writeOutcome: "none",
      warnings,
      error: serializeError(error, client?.token),
    };
  }

  if (scanned.repositories.length === 0) {
    return {
      status: "no_candidates",
      mode: runMode,
      owner,
      scanned: scanned.rawCount,
      candidateCount: 0,
      queryResults: scanned.queries,
      exclusions: scanned.excluded,
      results: [],
      operations: [],
      warnings,
      successCount: 0,
      failureCount: 0,
      writeSlotsUsed: 0,
      writePerformed: false,
      writeAttempted: false,
      writeMayHaveOccurred: false,
      writeOutcome: "none",
    };
  }

  const results = [];
  let writeSlotsUsed = 0;
  for (const source of scanned.repositories) {
    if (owner && splitRepositoryName(source).owner.toLowerCase() === owner.toLowerCase()) {
      results.push({ status: "skipped_self_owned", source: sanitizeRepository(source), writePerformed: false, writeAttempted: false, writeMayHaveOccurred: false, writeOutcome: "none", operations: [] });
      continue;
    }
    if (runMode === "apply" && writeSlotsUsed >= normalized.scan.maxForksPerRun) {
      results.push({ status: "skipped_limit", source: sanitizeRepository(source), writePerformed: false, writeAttempted: false, writeMayHaveOccurred: false, writeOutcome: "none", operations: [] });
      continue;
    }

    const operations = [];
    try {
      const existingFork = findExistingFork(ownedRepositories, source);
      if (existingFork) requirePersonalTarget(targetFromFork(existingFork, owner, existingFork.name), owner);
      const annotation = await annotate(source, annotateRepository);
      const topics = await authoritativeTopics({ client, source, existingFork });
      const initialMetadata = prepareRepositoryMetadata({ ...source, topics }, {
        chineseSummary: annotation?.chineseSummary,
        englishTags: annotation?.englishTags ?? annotation?.tags,
        maxTopics: normalized.topics.maxTopics,
      });

      if (runMode === "dry_run") {
        results.push({
          status: existingFork ? "planned_existing_fork" : "planned",
          source: sanitizeRepository(source),
          target: existingFork ? targetFromFork(existingFork, existingFork.owner?.login, existingFork.name) : null,
          metadata: { description: initialMetadata.description, topics: initialMetadata.topics },
          writePerformed: false,
          writeAttempted: false,
          writeMayHaveOccurred: false,
          writeOutcome: "none",
          operations,
        });
        continue;
      }

      writeSlotsUsed += 1;
      const completed = await organizeOne({
        client,
        source,
        existingFork,
        annotation,
        initialMetadata,
        owner,
        maxTopics: normalized.topics.maxTopics,
        options: { forkWaitAttempts, forkWaitDelayMs },
        operations,
        emit,
      });
      results.push(completed);
      await emit({ type: "repository_result", ...completed });
    } catch (error) {
      const failure = {
        status: "failed",
        source: sanitizeRepository(source),
        error: serializeError(error, client?.token),
        ...operationFlags(operations),
        writeOutcome: operationOutcome(operations, true),
        operations,
      };
      results.push(failure);
      await emit({ type: "repository_result", ...failure });
    }
  }

  const allOperations = results.flatMap((result) => result.operations ?? []);
  const failures = results.filter((result) => result.status === "failed");
  const successfulWrites = results.filter((result) => ["organized", "organized_existing_fork"].includes(result.status));
  const successfulPlans = results.filter((result) => ["planned", "planned_existing_fork"].includes(result.status));
  const hasFailure = failures.length > 0;
  const finalStatus = runMode === "dry_run"
    ? hasFailure ? "completed_with_failures" : "dry_run"
    : hasFailure ? "completed_with_failures" : successfulWrites.length ? "organized" : "no_changes";
  return {
    status: finalStatus,
    mode: runMode,
    owner,
    scanned: scanned.rawCount,
    candidateCount: scanned.repositories.length,
    queryResults: scanned.queries,
    exclusions: scanned.excluded,
    results,
    operations: allOperations,
    warnings,
    successCount: runMode === "dry_run" ? successfulPlans.length : successfulWrites.length,
    failureCount: failures.length,
    writeSlotsUsed,
    ...operationFlags(allOperations),
    writeOutcome: operationOutcome(allOperations, hasFailure),
  };
}

export async function runScheduledGitHubAutoForkAndOrganize(options = {}) {
  const config = normalizeGitHubAutomationConfig(options.config ?? {});
  if (!config.enabled || !config.schedule.enabled) {
    return { status: "disabled", writePerformed: false, writeAttempted: false, writeMayHaveOccurred: false, writeOutcome: "none", reason: `${GITHUB_AUTOMATION_NAME} schedule is disabled.` };
  }
  const automationResult = await runGitHubAutoForkAndOrganize({
    ...options,
    config,
    mode: config.schedule.apply ? "apply" : "dry_run",
    riskAcknowledged: config.riskAcknowledged,
  });
  if (typeof options.deliverResult !== "function") {
    return {
      ...automationResult,
      automationStatus: automationResult.status,
      status: "delivery_failed",
      delivery: { delivered: false, reason: "message_delivery_port_required" },
    };
  }
  try {
    const receipt = await options.deliverResult(automationResult);
    if (receipt?.delivered !== true) {
      return {
        ...automationResult,
        automationStatus: automationResult.status,
        status: "delivery_failed",
        delivery: { delivered: false, reason: "message_delivery_not_confirmed" },
      };
    }
    return { ...automationResult, delivery: { delivered: true, receipt: receipt.receipt ?? null } };
  } catch (error) {
    return {
      ...automationResult,
      automationStatus: automationResult.status,
      status: "delivery_failed",
      delivery: { delivered: false, reason: "message_delivery_error", error: serializeError(error) },
    };
  }
}

export function getGitHubAutomationSafetyContract(config = {}) {
  const normalized = normalizeGitHubAutomationConfig(config);
  return {
    name: GITHUB_AUTOMATION_NAME,
    enabled: normalized.enabled,
    defaultEnabled: false,
    dryRunByDefault: true,
    explicitApplyModeRequired: true,
    scheduleEnabled: normalized.schedule.enabled,
    scheduledApply: normalized.schedule.apply,
    tokenEnvVar: GITHUB_TOKEN_ENV_VAR,
    tokenAcceptedFromCli: false,
    riskAcknowledgementRequiredForApply: true,
    perRunRiskFlagRequiredForCliApply: true,
    metadataOnly: true,
    scheduledResultDeliveryRequired: true,
    operationStatuses: ["started", "confirmed", "rejected", "unknown"],
    maxQueries: normalized.scan.maxQueries,
    maxCandidates: normalized.scan.maxCandidates,
    maxForksPerRun: normalized.scan.maxForksPerRun,
    hardLimits: {
      maxQueries: GITHUB_SCAN_MAX_QUERIES,
      maxCandidates: GITHUB_SCAN_MAX_CANDIDATES,
      maxForksPerRun: GITHUB_SCAN_MAX_FORKS_PER_RUN,
    },
  };
}
