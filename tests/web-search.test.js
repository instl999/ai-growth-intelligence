import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchPlan, resolveWebResearchCapability, SKILL_DISCOVERY_SOURCES } from "../src/clients/web-search.js";

test("uses host web tools only when search and browsing are both available", () => {
  assert.deepEqual(resolveWebResearchCapability({ hasWebSearch: true, hasWebBrowse: true }), {
    mode: "host_web",
    canPublishVerifiedItems: true,
  });
  assert.equal(resolveWebResearchCapability({ hasWebSearch: true }).mode, "search_only");
});

test("requires approval before installing a discovery result", () => {
  const capability = resolveWebResearchCapability({ canDiscoverInstallableSkills: true });
  assert.equal(capability.mode, "discover_installable_skill");
  assert.equal(capability.requiresUserApproval, true);
  assert.equal(resolveWebResearchCapability({}).mode, "blocked");
});

test("builds section-specific verifiable research queries for the requested time window", () => {
  const plan = buildResearchPlan({ timeWindowHours: 24, now: new Date("2026-07-14T12:00:00.000Z") });
  assert.equal(plan.windowStart, "2026-07-13T12:00:00.000Z");
  assert.deepEqual(plan.queries.map((query) => query.section), ["github", "ai", "skill", "skill", "skill", "skill", "skill", "business", "growth"]);
  assert.throws(() => buildResearchPlan({ timeWindowHours: 0 }), /positive number/);
});

test("scans the five approved Skill discovery sources independently", () => {
  assert.deepEqual(SKILL_DISCOVERY_SOURCES.map((source) => source.domain), ["clawhub.ai", "skillhub.cn", "skills.sh", "skillsmp.com", "github.com"]);
  const skillsMp = SKILL_DISCOVERY_SOURCES.find((source) => source.domain === "skillsmp.com");
  assert.deepEqual(skillsMp, {
    name: "SkillsMP",
    domain: "skillsmp.com",
    url: "https://skillsmp.com/",
    query: "new trending updated Codex Claude agent skills workflow coding video image 3D SKILL.md",
  });
  const skillQueries = buildResearchPlan().queries.filter((query) => query.section === "skill");
  assert.equal(skillQueries.length, 5);
  for (const source of SKILL_DISCOVERY_SOURCES) {
    const query = skillQueries.find((candidate) => candidate.query.includes(`site:${source.domain}`));
    assert.ok(query);
    assert.match(query.sourceHint, /creator's repository or official documentation/);
    assert.match(query.verificationRules.join(" "), /directory listings only for discovery/);
  }
});
