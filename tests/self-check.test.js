import test from "node:test";
import assert from "node:assert/strict";
import {
  containsGitHubCredential,
  containsSkillHubCredential,
  containsWechatCredential,
  detectDamagedUnicode,
  isTextCandidateName,
  validateIdentityDocuments,
} from "../scripts/self-check-core.js";

test("self-check treats common secret/config files as text candidates", () => {
  assert.equal(isTextCandidateName(".env"), true);
  assert.equal(isTextCandidateName(".env.production"), true);
  assert.equal(isTextCandidateName("deploy.sh"), true);
  assert.equal(isTextCandidateName("LICENSE"), true);
});

test("self-check detects credential-shaped content without storing a fixture token", () => {
  const fakeCredential = "ghp_" + "a".repeat(36);
  const fakeFineGrained = "github_pat_" + "b".repeat(50);
  const fakeSkillHubCredential = "skh_" + "c".repeat(64);
  assert.equal(containsGitHubCredential(`GITHUB_TOKEN=${fakeCredential}`), true);
  assert.equal(containsGitHubCredential(fakeFineGrained), true);
  assert.equal(containsGitHubCredential("GITHUB_TOKEN is injected by the host"), false);
  assert.equal(containsSkillHubCredential(fakeSkillHubCredential), true);
  assert.equal(containsSkillHubCredential("SKILLHUB_TOKEN is injected by the release host"), false);
});

test("self-check detects damaged Unicode and historical command corruption", () => {
  assert.equal(detectDamagedUnicode("normal 中文 text"), false);
  assert.equal(detectDamagedUnicode("bad \uFFFD text"), true);
  assert.equal(detectDamagedUnicode("\npm.cmd test`"), true);
});

test("self-check rejects package-lock identity drift", () => {
  const documents = {
    packageJson: { name: "ai-growth-intelligence", version: "0.5.1" },
    packageLock: { name: "wrong", version: "0.5.1", packages: { "": { name: "wrong", version: "0.5.1" } } },
    skill: "name: ai-growth-intelligence\nmetadata:\n  slug: ai-growth-intelligence\n  version: \"0.5.1\"\n",
    openai: "default_prompt: Use $ai-growth-intelligence",
  };
  assert.ok(validateIdentityDocuments(documents).some((finding) => finding.includes("package-lock")));
});

test("self-check blocks a WeChat app secret value but not the variable name", () => {
  const fakeSecret = `${"a1b2c3d4e5f6a7b8"}${"c9d0e1f2a3b4c5d6"}`;
  assert.equal(containsWechatCredential(`WECHAT_APP_SECRET=${fakeSecret}`), true);
  assert.equal(containsWechatCredential(`appSecret: "${fakeSecret}"`), true);
  assert.equal(containsWechatCredential("WECHAT_APP_SECRET is injected by the host"), false);
  assert.equal(containsWechatCredential(`fingerprint ${fakeSecret}`), false);
});

test("identity validation follows package.json rather than a pinned version", () => {
  const documents = (version) => ({
    packageJson: { name: "ai-growth-intelligence", version },
    packageLock: { name: "ai-growth-intelligence", version, packages: { "": { name: "ai-growth-intelligence", version } } },
    skill: `name: ai-growth-intelligence\nmetadata:\n  slug: ai-growth-intelligence\n  version: "${version}"\n`,
    openai: "default_prompt: Use $ai-growth-intelligence",
  });
  assert.deepEqual(validateIdentityDocuments(documents("0.6.0")), []);
  assert.deepEqual(validateIdentityDocuments(documents("9.9.9")), []);
  const drifted = documents("0.6.0");
  drifted.skill = drifted.skill.replace("0.6.0", "0.5.9");
  assert.ok(validateIdentityDocuments(drifted).some((finding) => finding.includes("does not match package.json")));
  assert.ok(validateIdentityDocuments({ ...documents("0.6.0"), packageJson: { name: "ai-growth-intelligence", version: "v1" } })
    .some((finding) => finding.includes("semantic")));
});
