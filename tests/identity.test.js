import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_DIRECTORY_NAME } from "../src/storage/paths.js";
import { validateIdentityDocuments } from "../scripts/self-check-core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package, Skill and lockfile identity agree on one version", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const skill = await readFile(path.join(root, "SKILL.md"), "utf8");
  const openai = await readFile(path.join(root, "agents", "openai.yaml"), "utf8");
  assert.equal(packageJson.name, "ai-growth-intelligence");
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/u);
  assert.deepEqual(
    validateIdentityDocuments({ packageJson, packageLock, skill, openai }),
    [],
    "package.json is the single source of truth for the release version",
  );
});

test("legacy local data directory remains stable for compatibility", () => {
  assert.equal(SKILL_DIRECTORY_NAME, "growth-intelligence");
});
