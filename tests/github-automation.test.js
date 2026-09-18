import test from "node:test";
import assert from "node:assert/strict";
import { GitHubApiClient, GitHubApiError } from "../src/github/api-client.js";
import {
  GITHUB_REPOSITORY_DESCRIPTION_MAX_LENGTH,
  GITHUB_SCAN_MAX_FORKS_PER_RUN,
  GitHubMetadataError,
  buildHotRepositoryQueries,
  buildHotRepositoryQuery,
  composeOrganizedDescription,
  evaluateHotRepositories,
  mergeRepositoryTopics,
  normalizeEnglishTopic,
  normalizeGitHubAutomationConfig,
  prepareRepositoryMetadata,
} from "../src/github/metadata.js";
import {
  getGitHubAutomationSafetyContract,
  runGitHubAutoForkAndOrganize,
  runScheduledGitHubAutoForkAndOrganize,
  scanHotGitHubRepositories,
} from "../src/github/automation.js";

function repository(overrides = {}) {
  return {
    id: 1,
    full_name: "octocat/hello-world",
    name: "hello-world",
    owner: { login: "octocat" },
    html_url: "https://github.com/octocat/hello-world",
    description: "An English repository description.",
    topics: ["example"],
    language: "JavaScript",
    stargazers_count: 1_000,
    forks_count: 100,
    archived: false,
    disabled: false,
    fork: false,
    private: false,
    visibility: "public",
    pushed_at: "2026-08-06T00:00:00.000Z",
    updated_at: "2026-08-06T12:00:00.000Z",
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    enabled: true,
    scan: {
      sinceDays: 7,
      minStars: 10,
      maxCandidates: 5,
      maxForksPerRun: 2,
      maxQueries: 4,
      keywords: ["agent"],
    },
    ...overrides,
  };
}

function errorWith(message, properties = {}) {
  return Object.assign(new Error(message), properties);
}

class FakeClient {
  constructor({
    token = null,
    repositories = [repository()],
    ownedRepositories = [],
    failures = {},
    authenticatedUser = { login: "me", type: "User" },
    hydratedRepositories = {},
    forkOwner = "me",
  } = {}) {
    this.token = token;
    this.repositories = repositories;
    this.ownedRepositories = ownedRepositories;
    this.failures = failures;
    this.authenticatedUser = authenticatedUser;
    this.hydratedRepositories = hydratedRepositories;
    this.forkOwner = forkOwner;
    this.calls = [];
  }

  hasAuthentication() {
    return Boolean(this.token);
  }

  maybeFail(method) {
    const failure = this.failures[method];
    if (failure) throw typeof failure === "function" ? failure() : failure;
  }

  async searchRepositories() {
    this.calls.push("search");
    this.maybeFail("searchRepositories");
    return { total_count: this.repositories.length, items: this.repositories };
  }

  async getAuthenticatedUser() {
    this.calls.push("user");
    this.maybeFail("getAuthenticatedUser");
    return this.authenticatedUser;
  }

  async listOwnedRepositories() {
    this.calls.push("owned");
    this.maybeFail("listOwnedRepositories");
    return this.ownedRepositories;
  }

  async getRepository(owner, repo) {
    this.calls.push(`repo:${owner}/${repo}`);
    this.maybeFail("getRepository");
    return this.hydratedRepositories[`${owner}/${repo}`] ?? { owner: { login: owner }, name: repo };
  }

  async getRepositoryTopics(owner, repo) {
    this.calls.push(`get-topics:${owner}/${repo}`);
    this.maybeFail("getRepositoryTopics");
    return { names: owner === "octocat" || owner === "second" ? ["example"] : ["existing-topic"] };
  }

  async createFork(owner, repo) {
    this.calls.push(`fork:${owner}/${repo}`);
    this.maybeFail("createFork");
    return { owner: { login: this.forkOwner }, name: repo, html_url: `https://github.com/${this.forkOwner}/${repo}` };
  }

  async waitForRepository(owner, repo) {
    this.calls.push(`wait:${owner}/${repo}`);
    this.maybeFail("waitForRepository");
  }

  async updateRepository(owner, repo) {
    this.calls.push(`update:${owner}/${repo}`);
    this.maybeFail("updateRepository");
  }

  async replaceRepositoryTopics(owner, repo, topics) {
    this.calls.push(`topics:${owner}/${repo}:${topics.join(",")}`);
    this.maybeFail("replaceRepositoryTopics");
  }
}

const annotateRepository = async () => ({
  chineseSummary: "用于演示自动化工作流的项目",
  englishTags: ["agent-workflow", "javascript"],
});

const fixedNow = new Date("2026-08-07T12:00:00.000Z");

test("defaults GitHub automation to disabled and exposes the hardened safety contract", () => {
  const normalized = normalizeGitHubAutomationConfig();
  const contract = getGitHubAutomationSafetyContract();
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.dryRun, true);
  assert.equal(normalized.schedule.enabled, false);
  assert.equal(contract.name, "github自动fork并整理");
  assert.equal(contract.defaultEnabled, false);
  assert.equal(contract.explicitApplyModeRequired, true);
  assert.equal(contract.tokenAcceptedFromCli, false);
  assert.equal(contract.metadataOnly, true);
  assert.equal(contract.scheduledResultDeliveryRequired, true);
  assert.deepEqual(contract.operationStatuses, ["started", "confirmed", "rejected", "unknown"]);
  assert.deepEqual(contract.hardLimits, { maxQueries: 10, maxCandidates: 100, maxForksPerRun: 10 });
});

test("builds one public GitHub query per keyword without OR syntax", () => {
  const query = buildHotRepositoryQuery({ sinceDays: 7, minStars: 100, keywords: ["agent"], now: fixedNow });
  assert.match(query, /stars:>=100/u);
  assert.match(query, /pushed:>=2026-07-31/u);
  assert.match(query, /is:public/u);
  assert.match(query, /archived:false/u);
  assert.match(query, /fork:false/u);
  assert.match(query, /"agent"/u);
  assert.doesNotMatch(query, /\bOR\b/u);
  const queries = buildHotRepositoryQueries({ scan: { keywords: ["agent", "mcp", "codex"], maxQueries: 2 }, now: fixedNow });
  assert.deepEqual(queries.map((entry) => entry.term), ["agent", "mcp"]);
});

test("enforces hard safety caps and strict exclusion configuration", () => {
  assert.throws(() => normalizeGitHubAutomationConfig({ scan: { maxForksPerRun: GITHUB_SCAN_MAX_FORKS_PER_RUN + 1 } }), /between 1 and 10/u);
  assert.throws(() => normalizeGitHubAutomationConfig({ scan: { maxQueries: 11 } }), /between 1 and 10/u);
  assert.throws(() => normalizeGitHubAutomationConfig({ scan: { excludedOwners: ["valid", null] } }), /non-empty strings/u);
  assert.throws(() => normalizeGitHubAutomationConfig({ scan: { excludedRepositories: ["not-a-repository"] } }), /owner\/repository/u);
});

test("excludes malformed, private, stale, duplicate, configured, and over-limit candidates", () => {
  const candidates = [
    repository(),
    repository({ full_name: "octocat/hello-world" }),
    repository({ full_name: "bad/date", name: "date", pushed_at: "not-a-date" }),
    repository({ full_name: "old/repo", name: "repo", pushed_at: "2026-01-01T00:00:00.000Z" }),
    repository({ full_name: "private/repo", name: "repo", owner: { login: "private" }, private: true, visibility: undefined }),
    repository({ full_name: "bad/name/extra", name: "extra", owner: { login: "bad" } }),
    repository({ full_name: "excluded/repo", name: "repo", owner: { login: "excluded" } }),
    repository({ full_name: "owner-blocked/repo", name: "repo", owner: { login: "owner-blocked" } }),
    repository({ full_name: "second/repo", name: "repo", owner: { login: "second" }, stargazers_count: 900 }),
  ];
  const evaluated = evaluateHotRepositories(candidates, {
    scan: {
      sinceDays: 7,
      minStars: 10,
      maxCandidates: 1,
      excludedRepositories: ["EXCLUDED/REPO"],
      excludedOwners: ["OWNER-BLOCKED"],
    },
    now: fixedNow,
  });
  assert.equal(evaluated.repositories.length, 1);
  const reasons = evaluated.excluded.flatMap((item) => item.reasons);
  for (const reason of ["duplicate_query_result", "invalid_pushed_at", "not_recently_pushed", "not_public", "missing_or_invalid_full_name", "excluded_repository", "excluded_owner", "candidate_limit"]) {
    assert.ok(reasons.includes(reason), `missing exclusion reason ${reason}`);
  }
});

test("scan returns exclusions rather than aborting on malformed GitHub items", async () => {
  const client = new FakeClient({ repositories: [repository({ pushed_at: null }), repository({ full_name: null, owner: null })] });
  const result = await scanHotGitHubRepositories({ client, config: config(), now: fixedNow });
  assert.equal(result.repositories.length, 0);
  assert.equal(result.excluded.length, 2);
  assert.ok(result.excluded.some((entry) => entry.reasons.includes("missing_pushed_at")));
  assert.ok(result.excluded.some((entry) => entry.reasons.includes("missing_or_invalid_full_name")));
});

test("scan fails closed on a malformed GitHub search response", async () => {
  await assert.rejects(
    () => scanHotGitHubRepositories({ client: { searchRepositories: async () => ({ total_count: 0 }) }, config: config(), now: fixedNow }),
    (error) => error.code === "invalid_search_response",
  );
});

test("preserves the exact original English description and rejects over-limit composition", () => {
  assert.equal(
    composeOrganizedDescription({ chineseSummary: "一个用于自动化的项目", englishDescription: "  Automate tasks.  " }),
    "中文简介：一个用于自动化的项目 | English description:   Automate tasks.  ",
  );
  assert.equal(composeOrganizedDescription({ chineseSummary: "𠀀类汉字简介", englishDescription: "Original." }).includes("𠀀"), true);
  assert.throws(() => composeOrganizedDescription({ chineseSummary: "Only English" }), (error) => error instanceof GitHubMetadataError && error.code === "chinese_summary_required");
  assert.throws(
    () => composeOrganizedDescription({ chineseSummary: "简明说明", englishDescription: "a".repeat(GITHUB_REPOSITORY_DESCRIPTION_MAX_LENGTH) }),
    (error) => error.code === "description_too_long",
  );
});

test("preserves all topics and rejects malformed, overlong, or over-capacity additions", () => {
  assert.deepEqual(mergeRepositoryTopics(["Existing"], ["new tag", "new_tag"], 3), ["existing", "new-tag"]);
  assert.throws(() => mergeRepositoryTopics(["one", "two"], ["three"], 2), (error) => error.code === "topic_capacity_exceeded");
  assert.throws(() => mergeRepositoryTopics([], ["中文标签"]), (error) => error.code === "invalid_topic");
  assert.throws(() => normalizeEnglishTopic("a".repeat(51)), (error) => error.code === "topic_too_long");
  const metadata = prepareRepositoryMetadata(repository(), { chineseSummary: "一个用于自动化的项目", englishTags: ["Agent Workflow", "javascript"] });
  assert.deepEqual(metadata.topics, ["example", "agent-workflow", "javascript"]);
});

test("disabled core invocation does not construct the default client", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    const result = await runGitHubAutoForkAndOrganize({ config: { enabled: false }, annotateRepository });
    assert.equal(result.status, "disabled");
    assert.equal(result.writeAttempted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("omitted mode remains dry-run even when config.dryRun is false", async () => {
  const client = new FakeClient();
  const result = await runGitHubAutoForkAndOrganize({ client, config: config({ dryRun: false }), annotateRepository, now: fixedNow });
  assert.equal(result.mode, "dry_run");
  assert.equal(result.status, "dry_run");
  assert.ok(client.calls.every((call) => !/^(fork|update|topics):/u.test(call)));
});

test("dry-run uses authoritative source topics without authentication or writes", async () => {
  const client = new FakeClient();
  const result = await runGitHubAutoForkAndOrganize({ client, config: config(), mode: "dry_run", annotateRepository, now: fixedNow });
  assert.equal(result.status, "dry_run");
  assert.equal(result.results[0].status, "planned");
  assert.deepEqual(result.results[0].metadata.topics, ["example", "agent-workflow", "javascript"]);
  assert.deepEqual(client.calls, ["search", "get-topics:octocat/hello-world"]);
});

test("dry-run optional authentication failure becomes a redacted warning", async () => {
  const leak = "ghp_" + "1".repeat(36);
  const client = new FakeClient({ token: "test-token", failures: { getAuthenticatedUser: errorWith(`bad ${leak}`, { code: "bad_credentials", status: 401 }) } });
  const result = await runGitHubAutoForkAndOrganize({ client, config: config(), mode: "dry_run", annotateRepository, now: fixedNow });
  assert.equal(result.status, "dry_run");
  assert.equal(result.warnings[0].code, "optional_authentication_failed");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(leak, "u"));
  assert.deepEqual(client.calls, ["user", "search", "get-topics:octocat/hello-world"]);
});

test("dry-run reports candidate failures at the top level", async () => {
  const client = new FakeClient();
  const result = await runGitHubAutoForkAndOrganize({ client, config: config(), mode: "dry_run", annotateRepository: async () => null, now: fixedNow });
  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.successCount, 0);
  assert.equal(result.failureCount, 1);
  assert.equal(result.results[0].status, "failed");
});

test("apply requires both stored and per-invocation risk acknowledgement", async () => {
  const client = new FakeClient({ token: "test-token" });
  const missingStored = await runGitHubAutoForkAndOrganize({ client, config: config(), mode: "apply", riskAcknowledged: true, annotateRepository });
  const missingInvocation = await runGitHubAutoForkAndOrganize({ client, config: config({ riskAcknowledged: true }), mode: "apply", annotateRepository });
  assert.equal(missingStored.reason, "risk_acknowledgement_required");
  assert.equal(missingInvocation.reason, "risk_acknowledgement_required");
  assert.deepEqual(client.calls, []);
});

test("acknowledged apply without a token is blocked before API calls", async () => {
  const client = new FakeClient();
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
  });
  assert.equal(result.reason, "missing_github_token");
  assert.deepEqual(client.calls, []);
});

test("apply with missing client capabilities is blocked before authentication", async () => {
  const client = { token: "test-token", hasAuthentication: () => true, calls: [] };
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
  });
  assert.equal(result.reason, "client_capability_missing");
  assert.ok(result.missingCapabilities.includes("searchRepositories"));
  assert.ok(result.missingCapabilities.includes("waitForRepository"));
});

test("apply returns a structured personal-authentication failure before scanning", async () => {
  const client = new FakeClient({ token: "test-token", failures: { getAuthenticatedUser: errorWith("token rejected", { code: "bad_credentials", status: 401 }) } });
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stage, "authentication");
  assert.deepEqual(client.calls, ["user"]);

  const nonPersonal = new FakeClient({ token: "test-token", authenticatedUser: { login: "bot", type: "Bot" } });
  const rejected = await runGitHubAutoForkAndOrganize({
    client: nonPersonal,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
  });
  assert.equal(rejected.error.code, "personal_owner_required");

  const missingType = new FakeClient({ token: "test-token", authenticatedUser: { login: "ambiguous" } });
  const failClosed = await runGitHubAutoForkAndOrganize({
    client: missingType,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
  });
  assert.equal(failClosed.error.code, "personal_owner_required");
  assert.deepEqual(missingType.calls, ["user"]);
});

test("apply creates a personal Fork and emits confirmed operation transitions", async () => {
  const client = new FakeClient({ token: "test-token" });
  const events = [];
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    logger: async (event) => { events.push(event); },
    forkWaitDelayMs: 0,
    now: fixedNow,
  });
  assert.equal(result.status, "organized");
  assert.equal(result.writeOutcome, "confirmed");
  assert.equal(result.writeAttempted, true);
  assert.equal(result.writePerformed, true);
  assert.equal(result.writeMayHaveOccurred, true);
  assert.deepEqual(result.operations.map(({ operation, status }) => ({ operation, status })), [
    { operation: "create_fork", status: "confirmed" },
    { operation: "update_description", status: "confirmed" },
    { operation: "replace_topics", status: "confirmed" },
  ]);
  assert.ok(events.some((event) => event.type === "operation" && event.operation === "create_fork" && event.status === "started"));
  assert.ok(events.some((event) => event.type === "operation" && event.operation === "replace_topics" && event.status === "confirmed"));
  assert.deepEqual(client.calls, [
    "user",
    "owned",
    "search",
    "get-topics:octocat/hello-world",
    "fork:octocat/hello-world",
    "wait:me/hello-world",
    "get-topics:me/hello-world",
    "update:me/hello-world",
    "topics:me/hello-world:existing-topic,agent-workflow,javascript",
  ]);
});

test("unknown first mutation consumes a slot and warns that a write may have occurred", async () => {
  const client = new FakeClient({ token: "test-token", failures: { createFork: errorWith("connection lost", { code: "network_error" }) } });
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    now: fixedNow,
  });
  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.writeSlotsUsed, 1);
  assert.equal(result.writeOutcome, "unknown");
  assert.equal(result.writeAttempted, true);
  assert.equal(result.writePerformed, false);
  assert.equal(result.writeMayHaveOccurred, true);
  assert.equal(result.operations[0].status, "unknown");
});

test("definitive mutation rejection is not reported as an unknown remote write", async () => {
  const client = new FakeClient({ token: "test-token", failures: { createFork: errorWith("validation failed", { code: "github_api_error", status: 422 }) } });
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    now: fixedNow,
  });
  assert.equal(result.operations[0].status, "rejected");
  assert.equal(result.writeAttempted, true);
  assert.equal(result.writeMayHaveOccurred, false);
  assert.equal(result.writeOutcome, "none");
});

test("partial writes stay visible, consume the limit, and redact token-shaped errors", async () => {
  const second = repository({ id: 2, full_name: "second/project", name: "project", owner: { login: "second" }, stargazers_count: 900 });
  const leak = "github_pat_" + "z".repeat(50);
  const client = new FakeClient({
    token: "test-token",
    repositories: [repository(), second],
    failures: { replaceRepositoryTopics: errorWith(`request failed ${leak}`, { code: "network_error" }) },
  });
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true, scan: { ...config().scan, maxForksPerRun: 1 } }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    forkWaitDelayMs: 0,
    now: fixedNow,
  });
  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.writeSlotsUsed, 1);
  assert.equal(result.writeOutcome, "partial");
  assert.deepEqual(result.results[0].operations.map(({ status }) => status), ["confirmed", "confirmed", "unknown"]);
  assert.equal(result.results[1].status, "skipped_limit");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(leak, "u"));
});

test("async logger rejection adds warnings without changing successful writes", async () => {
  const client = new FakeClient({ token: "test-token" });
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    logger: async () => { throw new Error("log sink unavailable"); },
    forkWaitDelayMs: 0,
    now: fixedNow,
  });
  assert.equal(result.status, "organized");
  assert.ok(result.warnings.length >= 1);
  assert.ok(result.warnings.every((warning) => warning.code === "logger_failed"));
});

test("existing Fork is hydrated, reused, and reorganized without duplicate creation", async () => {
  const listedFork = { fork: true, owner: { login: "me" }, name: "hello-world", html_url: "https://github.com/me/hello-world" };
  const hydratedFork = { ...listedFork, parent: { full_name: "octocat/hello-world" } };
  const client = new FakeClient({
    token: "test-token",
    ownedRepositories: [listedFork],
    hydratedRepositories: { "me/hello-world": hydratedFork },
  });
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    now: fixedNow,
  });
  assert.equal(result.status, "organized");
  assert.equal(result.results[0].status, "organized_existing_fork");
  assert.ok(client.calls.includes("repo:me/hello-world"));
  assert.equal(client.calls.some((call) => call.startsWith("fork:")), false);
  assert.equal(client.calls.filter((call) => call === "get-topics:me/hello-world").length, 2);
  assert.ok(client.calls.includes("update:me/hello-world"));
});

test("Fork owner mismatch stops metadata writes and records the confirmed Fork", async () => {
  const client = new FakeClient({ token: "test-token", forkOwner: "someone-else" });
  const result = await runGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    now: fixedNow,
  });
  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.results[0].error.code, "fork_owner_mismatch");
  assert.equal(result.results[0].operations[0].status, "confirmed");
  assert.equal(result.results[0].writeOutcome, "partial");
  assert.equal(client.calls.some((call) => call.startsWith("update:")), false);
});

test("empty scans return no_candidates and self-owned sources are skipped", async () => {
  const empty = await runGitHubAutoForkAndOrganize({ client: new FakeClient({ repositories: [] }), config: config(), mode: "dry_run", annotateRepository, now: fixedNow });
  assert.equal(empty.status, "no_candidates");
  const selfClient = new FakeClient({ token: "test-token", repositories: [repository({ full_name: "me/project", name: "project", owner: { login: "me" } })] });
  const self = await runGitHubAutoForkAndOrganize({
    client: selfClient,
    config: config({ riskAcknowledged: true }),
    mode: "apply",
    riskAcknowledged: true,
    annotateRepository,
    now: fixedNow,
  });
  assert.equal(self.status, "no_changes");
  assert.equal(self.results[0].status, "skipped_self_owned");
  assert.equal(self.writeSlotsUsed, 0);
});

test("scheduled entry is default-off and enabled preview requires confirmed delivery", async () => {
  const disabledClient = new FakeClient({ token: "test-token" });
  const disabled = await runScheduledGitHubAutoForkAndOrganize({ client: disabledClient, config: config({ schedule: { enabled: false, apply: true } }), annotateRepository });
  assert.equal(disabled.status, "disabled");
  assert.deepEqual(disabledClient.calls, []);

  const previewClient = new FakeClient();
  const delivered = await runScheduledGitHubAutoForkAndOrganize({
    client: previewClient,
    config: config({ schedule: { enabled: true, apply: false } }),
    annotateRepository,
    now: fixedNow,
    deliverResult: async (result) => ({ delivered: result.status === "dry_run", receipt: "simulated-receipt" }),
  });
  assert.equal(delivered.status, "dry_run");
  assert.equal(delivered.delivery.delivered, true);
  assert.equal(previewClient.calls.some((call) => call.startsWith("fork:")), false);

  const noDelivery = await runScheduledGitHubAutoForkAndOrganize({
    client: new FakeClient(),
    config: config({ schedule: { enabled: true, apply: false } }),
    annotateRepository,
    now: fixedNow,
  });
  assert.equal(noDelivery.status, "delivery_failed");
  assert.equal(noDelivery.automationStatus, "dry_run");
});

test("enabled scheduled apply preserves all live gates and write limits", async () => {
  const client = new FakeClient({ token: "test-token" });
  const result = await runScheduledGitHubAutoForkAndOrganize({
    client,
    config: config({ riskAcknowledged: true, schedule: { enabled: true, apply: true } }),
    annotateRepository,
    now: fixedNow,
    forkWaitDelayMs: 0,
    deliverResult: async () => ({ delivered: true }),
  });
  assert.equal(result.status, "organized");
  assert.equal(result.writeSlotsUsed, 1);
  assert.equal(result.delivery.delivered, true);
});

function response(status, body, { redirected = false, retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected,
    text: async () => body === null ? "" : JSON.stringify(body),
    headers: { get: (name) => name.toLowerCase() === "retry-after" ? retryAfter : null },
  };
}

test("GitHub API client restricts authentication to the official origin", async () => {
  const calls = [];
  const client = new GitHubApiClient({
    token: "secret-token",
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return response(200, { items: [] }); },
  });
  await client.searchRepositories({ query: "stars:>=10 is:public" });
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/search\/repositories\?/u);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].options.redirect, "error");
  assert.throws(() => new GitHubApiClient({ token: "secret-token", apiBaseUrl: "https://api.example.test" }), (error) => error.code === "unsafe_authenticated_api_origin");
});

test("real REST adapter methods use the expected methods, paths, bodies, and authentication", async () => {
  const calls = [];
  const client = new GitHubApiClient({
    token: "test-token",
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      const pathname = new URL(url).pathname;
      if (pathname === "/user/repos") return response(200, [{ name: "one" }]);
      if (pathname.endsWith("/topics")) return response(200, { names: ["one"] });
      if (pathname.endsWith("/forks")) return response(202, { owner: { login: "me" }, name: "repo" });
      return response(200, { login: "me", type: "User" });
    },
  });
  await client.getAuthenticatedUser();
  await client.listOwnedRepositories({ perPage: 2 });
  await client.getRepository("owner", "repo", { requiresAuth: true });
  await client.getRepositoryTopics("owner", "repo", { requiresAuth: true });
  await client.createFork("owner", "repo", {});
  await client.updateRepository("me", "repo", { description: "description" });
  await client.replaceRepositoryTopics("me", "repo", ["one"]);
  await client.waitForRepository("me", "repo", { attempts: 1, delayMs: 0 });
  const summary = calls.map(({ url, options }) => ({ method: options.method, path: url.pathname, body: options.body ? JSON.parse(options.body) : null }));
  assert.ok(summary.some((entry) => entry.method === "POST" && entry.path === "/repos/owner/repo/forks" && Object.keys(entry.body).length === 0));
  assert.ok(summary.some((entry) => entry.method === "PATCH" && entry.path === "/repos/me/repo" && entry.body.description === "description"));
  assert.ok(summary.some((entry) => entry.method === "PUT" && entry.path === "/repos/me/repo/topics" && entry.body.names[0] === "one"));
  assert.ok(calls.every(({ options }) => options.headers.Authorization === "Bearer test-token"));
});

test("owned-repository pagination fails closed on invalid or truncated responses", async () => {
  const invalid = new GitHubApiClient({ token: "test-token", fetchImpl: async () => response(200, { not: "an array" }) });
  await assert.rejects(() => invalid.listOwnedRepositories(), (error) => error.code === "invalid_response");
  const truncated = new GitHubApiClient({ token: "test-token", fetchImpl: async () => response(200, [{ name: "one" }]) });
  await assert.rejects(() => truncated.listOwnedRepositories({ perPage: 1, maxPages: 1 }), (error) => error.code === "owned_repository_list_truncated");
});

test("GitHub API client blocks redirects, enforces timeout even when fetch ignores abort, and redacts failures", async () => {
  const redirected = new GitHubApiClient({ fetchImpl: async () => response(200, {}, { redirected: true }) });
  await assert.rejects(() => redirected.searchRepositories({ query: "stars:>=10" }), (error) => error.code === "unsafe_redirect");

  const timedOut = new GitHubApiClient({ requestTimeoutMs: 5, fetchImpl: async () => new Promise(() => {}) });
  await assert.rejects(() => timedOut.searchRepositories({ query: "stars:>=10" }), (error) => error.code === "request_timeout");

  const failing = new GitHubApiClient({
    token: "secret-token",
    fetchImpl: async () => response(403, { message: "rate limited secret-token" }, { retryAfter: "10" }),
  });
  await assert.rejects(() => failing.getAuthenticatedUser(), (error) => {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.status, 403);
    assert.equal(error.retryAfter, "10");
    assert.doesNotMatch(error.message, /secret-token/u);
    return true;
  });
});
