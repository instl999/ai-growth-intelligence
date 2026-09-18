import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseUserIntent } from "../src/clients/adapter.js";
import { runCli, runCliCommand } from "../src/cli/index.js";
import {
  GitHubCommandError,
  parseGitHubCommandArgs,
  runGitHubAutomationCommand,
} from "../src/github/command.js";

// Eligibility rejects anything pushed more than scan.sinceDays (7) ago. Pin both
// sides of that comparison: the command takes an injected clock, and the fixture
// sits one day before it. An absolute fixture date with a live clock is what
// silently rotted this suite a week after it was written.
const NOW = new Date("2026-09-06T00:00:00.000Z");
const RECENTLY_PUSHED_AT = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();

function repository() {
  return {
    full_name: "octocat/hello-world",
    name: "hello-world",
    owner: { login: "octocat" },
    html_url: "https://github.com/octocat/hello-world",
    description: "An English repository description.",
    topics: ["example"],
    stargazers_count: 1_000,
    forks_count: 100,
    archived: false,
    disabled: false,
    fork: false,
    visibility: "public",
    pushed_at: RECENTLY_PUSHED_AT,
  };
}

class ReadOnlyClient {
  constructor() {
    this.calls = [];
  }

  async searchRepositories() {
    this.calls.push("search");
    return { total_count: 1, items: [repository()] };
  }

  async getRepositoryTopics(owner, repo, options) {
    this.calls.push(["topics", owner, repo, options]);
    return { names: ["example"] };
  }
}

const annotations = {
  "octocat/hello-world": {
    chineseSummary: "用于演示的项目",
    englishTags: ["example"],
  },
};

async function withJsonFiles(configDocument, annotationsDocument, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-growth-intelligence-test-"));
  try {
    const configPath = path.join(directory, "config.json");
    const annotationsPath = path.join(directory, "annotations.json");
    await writeFile(configPath, JSON.stringify(configDocument), "utf8");
    await writeFile(annotationsPath, JSON.stringify(annotationsDocument), "utf8");
    return await callback({ configPath, annotationsPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("recognizes explicit github自动fork并整理 requests without enabling them", () => {
  assert.deepEqual(parseUserIntent("github自动fork并整理"), {
    type: "github_auto_fork_and_organize",
    action: "explain",
    mode: "dry_run",
  });
  assert.deepEqual(parseUserIntent("启用github自动fork并整理"), {
    type: "github_auto_fork_and_organize",
    action: "enable",
    mode: "dry_run",
  });
  assert.equal(parseUserIntent("关闭github自动fork并整理").action, "disable");
});

test("negative GitHub automation requests never become enable or apply intents", () => {
  for (const text of [
    "不需要github自动fork并整理",
    "不要运行github自动fork并整理",
    "不要写入 github auto-fork-and-organize",
  ]) {
    assert.deepEqual(parseUserIntent(text), {
      type: "github_auto_fork_and_organize",
      action: "disable",
      mode: "dry_run",
    });
  }
});

test("CLI contract inspection is read-only and default-off", () => {
  const result = runCli(["github-automation"]);
  assert.equal(result.defaultEnabled, false);
  assert.equal(result.metadataOnly, true);
  assert.equal(result.tokenEnvVar, "GITHUB_TOKEN");
  assert.equal(result.tokenAcceptedFromCli, false);
});

test("CLI rejects unsupported commands, duplicate flags, and secret-bearing options", () => {
  assert.deepEqual(parseGitHubCommandArgs(["--config", "config.json", "--acknowledge-risk"]), {
    configPath: "config.json",
    acknowledgeRisk: true,
  });
  assert.throws(
    () => parseGitHubCommandArgs(["--token", "do-not-accept"]),
    (error) => error instanceof GitHubCommandError && error.code === "unknown_option",
  );
  assert.throws(
    () => parseGitHubCommandArgs(["--acknowledge-risk", "--acknowledge-risk"]),
    (error) => error instanceof GitHubCommandError && error.code === "duplicate_option",
  );
  assert.throws(
    () => runCli(["unknown-command"]),
    (error) => error instanceof GitHubCommandError && error.code === "unsupported_command",
  );
});

test("configuration and annotation documents reject credential material before client creation", async () => {
  let factoryCalls = 0;
  await assert.rejects(
    runGitHubAutomationCommand({
      command: "github-scan",
      configDocument: { enabled: true, githubToken: "not-accepted" },
      clientFactory: () => { factoryCalls += 1; },
    }),
    (error) => error instanceof GitHubCommandError && error.code === "credential_field_forbidden",
  );

  const credentialShaped = ["github", "pat", "1234567890abcdef"].join("_");
  await assert.rejects(
    runGitHubAutomationCommand({
      command: "github-run",
      configDocument: { enabled: true },
      annotationsDocument: {
        "octocat/hello-world": {
          chineseSummary: credentialShaped,
          englishTags: ["example"],
        },
      },
      mode: "dry_run",
      clientFactory: () => { factoryCalls += 1; },
    }),
    (error) => error instanceof GitHubCommandError && error.code === "credential_material_forbidden",
  );

  await assert.rejects(
    runGitHubAutomationCommand({
      command: "github-run",
      configDocument: { enabled: true },
      annotationsDocument: { "Octocat/Hello-World": annotations["octocat/hello-world"] },
      mode: "dry_run",
      clientFactory: () => { factoryCalls += 1; },
    }),
    (error) => error instanceof GitHubCommandError && error.code === "invalid_annotation_key",
  );
  assert.equal(factoryCalls, 0);
});

test("disabled command exits before constructing a GitHub client", async () => {
  let factoryCalls = 0;
  const result = await runGitHubAutomationCommand({
    command: "github-scan",
    configDocument: { enabled: false },
    clientFactory: () => { factoryCalls += 1; throw new Error("must not run"); },
  });
  assert.equal(result.status, "disabled");
  assert.equal(factoryCalls, 0);
});

test("scan creates an explicitly unauthenticated client and returns candidates", async () => {
  const client = new ReadOnlyClient();
  const options = [];
  const result = await runGitHubAutomationCommand({
    command: "github-scan",
    configDocument: { enabled: true, scan: { keywords: ["agent"] } },
    clientFactory: (value) => { options.push(value); return client; },
    now: new Date("2026-08-07T12:00:00.000Z"),
  });
  assert.equal(result.status, "scanned");
  assert.equal(result.mode, "scan");
  assert.equal(result.writePerformed, false);
  assert.equal(result.candidates[0].fullName, "octocat/hello-world");
  assert.deepEqual(options, [{ token: null }]);
  assert.deepEqual(client.calls, ["search"]);
});

test("CLI apply requires both persistent acknowledgement and the per-run flag", async () => {
  let factoryCalls = 0;
  const missingConfigAck = await runGitHubAutomationCommand({
    command: "github-run",
    configDocument: { enabled: true, riskAcknowledged: false },
    annotationsDocument: annotations,
    mode: "apply",
    acknowledgeRisk: true,
    clientFactory: () => { factoryCalls += 1; },
  });
  const missingRunAck = await runGitHubAutomationCommand({
    command: "github-run",
    configDocument: { enabled: true, riskAcknowledged: true },
    annotationsDocument: annotations,
    mode: "apply",
    acknowledgeRisk: false,
    clientFactory: () => { factoryCalls += 1; },
  });
  assert.equal(missingConfigAck.reason, "risk_acknowledgement_required");
  assert.equal(missingRunAck.reason, "risk_acknowledgement_required");
  assert.equal(factoryCalls, 0);
});

test("file-backed github-scan remains disabled and performs zero GitHub calls by default", async () => {
  await withJsonFiles(
    { githubAutoForkAndOrganize: { enabled: false } },
    annotations,
    async ({ configPath }) => {
      const result = await runCliCommand(["github-scan", "--config", configPath], {
        clientFactory: () => { throw new Error("must not create client"); },
      });
      assert.equal(result.status, "disabled");
    },
  );
});

test("file-backed enabled github-run executes only the explicit dry-run mode", async () => {
  await withJsonFiles(
    { githubAutoForkAndOrganize: { enabled: true, dryRun: false, scan: { minStars: 1, keywords: ["agent"] } } },
    annotations,
    async ({ configPath, annotationsPath }) => {
      const client = new ReadOnlyClient();
      const result = await runCliCommand([
        "github-run",
        "--config", configPath,
        "--annotations", annotationsPath,
        "--mode", "dry_run",
      ], { clientFactory: () => client, now: NOW });
      assert.equal(result.status, "dry_run");
      assert.equal(result.mode, "dry_run");
      assert.equal(result.writeAttempted, false);
      assert.deepEqual(client.calls, ["search", ["topics", "octocat", "hello-world", { requiresAuth: false }]]);
    },
  );
});

test("file-backed apply without the per-run flag is blocked before constructing a client", async () => {
  await withJsonFiles(
    { githubAutoForkAndOrganize: { enabled: true, riskAcknowledged: true } },
    annotations,
    async ({ configPath, annotationsPath }) => {
      let factoryCalls = 0;
      const result = await runCliCommand([
        "github-run",
        "--config", configPath,
        "--annotations", annotationsPath,
        "--mode", "apply",
      ], { clientFactory: () => { factoryCalls += 1; } });
      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "risk_acknowledgement_required");
      assert.equal(factoryCalls, 0);
    },
  );
});

test("injected dependencies cannot override parsed mode or risk acknowledgement", async () => {
  await withJsonFiles(
    { githubAutoForkAndOrganize: { enabled: true, riskAcknowledged: false, scan: { minStars: 1, keywords: ["agent"] } } },
    annotations,
    async ({ configPath, annotationsPath }) => {
      const client = new ReadOnlyClient();
      const result = await runCliCommand([
        "github-run",
        "--config", configPath,
        "--annotations", annotationsPath,
        "--mode", "dry_run",
      ], {
        clientFactory: () => client,
        mode: "apply",
        acknowledgeRisk: true,
      });
      assert.equal(result.mode, "dry_run");
      assert.equal(result.writeAttempted, false);
    },
  );
});

test("the command honours an injected clock, so recency is testable without the wall clock", async () => {
  await withJsonFiles(
    { githubAutoForkAndOrganize: { enabled: true, dryRun: false, scan: { minStars: 1, keywords: ["agent"] } } },
    annotations,
    async ({ configPath, annotationsPath }) => {
      // The same fixture, judged from a clock two weeks later, ages out.
      const later = new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
      const result = await runCliCommand([
        "github-run", "--config", configPath, "--annotations", annotationsPath, "--mode", "dry_run",
      ], { clientFactory: () => new ReadOnlyClient(), now: later });
      assert.equal(result.status, "no_candidates");
    },
  );
});
