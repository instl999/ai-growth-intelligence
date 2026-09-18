import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const REQUIRED_FILES = [

  "SKILL.md",
  "agents/openai.yaml",
  "package.json",
  "package-lock.json",
  "references/github-selection-policy.md",
  "references/github-auto-fork-and-organize.md",
  "references/preview-workflow.md",
  "references/message-delivery-protocol.md",
  "references/wechat-draft-box.md",
  "src/github/api-client.js",
  "src/github/automation.js",
  "src/github/command.js",
  "src/github/metadata.js",
  "references/section-windows.md",
  "src/core/delivery-plan.js",
  "src/core/section-policy.js",
  "src/storage/recommendation-history.js",
  "src/wechat/api-client.js",
  "src/wechat/command.js",
  "src/wechat/cover-cache.js",
  "src/wechat/cover.js",
  "src/wechat/draft.js",
  "src/wechat/html.js",
  "src/wechat/png.js",
];

export const FORBIDDEN_RUNTIME_PATTERNS = [
  "@oai/",
  "workspace:",
  "/mnt/data",
  "SEARCH_PROVIDER",
  "SEARCH_API_KEY",
  "GROWTH_INTELLIGENCE_DASHBOARD_PASSWORD",
];

export const GITHUB_CREDENTIAL_PATTERNS = [
  /gh[pousrue]_[A-Za-z0-9]{30,}/u,
  /github_pat_[A-Za-z0-9_]{40,}/u,
];

export const SKILLHUB_CREDENTIAL_PATTERNS = [
  /skh_[A-Za-z0-9]{32,}/u,
];

// The WeChat feature names these variables all over its documentation, so the
// name alone cannot be forbidden. What must never be committed is a value: an
// appsecret is 32 lowercase hex characters, matched only next to a WeChat key.
export const WECHAT_CREDENTIAL_PATTERNS = [
  /WECHAT_APP_SECRET\s*[:=]\s*["']?[0-9a-f]{32}\b/iu,
  /\bapp_?secret\s*[:=]\s*["']?[0-9a-f]{32}\b/iu,
];

const REMOVED_WEB_ARTIFACTS = ["demo.html", "src/dashboard", "tests/dashboard.test.js", "references/dashboard-runtime.md"];
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "_bmad", ".agents", ".codex", "_rewrite", "_rewrite2", "_rewrite3", ".tmp-growth-intelligence-0.4.3-base"]);
const TEXT_EXTENSIONS = new Set([
  ".bat", ".cmd", ".conf", ".diff", ".env", ".ini", ".js", ".json", ".md", ".patch", ".ps1", ".sh", ".toml", ".txt", ".yaml", ".yml",
]);
// Documents that ship with the package and carry Chinese text worth guarding
// against mojibake. Listing files that are not shipped makes the check a no-op.
const ACTIVE_CONTROL_DOCUMENTS = [
  "SKILL.md",
  "README.md",
  "docs/skillhub/README.zh-CN.md",
  "docs/skillhub/README.en.md",
  "references/wechat-draft-box.md",
  "references/github-auto-fork-and-organize.md",
];

export function isTextCandidateName(name) {
  const lower = name.toLowerCase();
  return lower.startsWith(".env") || path.extname(lower) === "" || TEXT_EXTENSIONS.has(path.extname(lower));
}

function isExcludedDirectory(name) {
  return EXCLUDED_DIRECTORIES.has(name) || name.startsWith("_review-work-");
}

export function collectTextCandidateFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && isExcludedDirectory(entry.name)) return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTextCandidateFiles(entryPath);
    return isTextCandidateName(entry.name) ? [entryPath] : [];
  });
}

function readLikelyText(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

export function containsGitHubCredential(content) {
  return GITHUB_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(String(content ?? "")));
}

export function containsSkillHubCredential(content) {
  return SKILLHUB_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(String(content ?? "")));
}

export function containsWechatCredential(content) {
  return WECHAT_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(String(content ?? "")));
}

export function detectDamagedUnicode(content) {
  const value = String(content ?? "");
  return value.includes("\uFFFD")
    || value.includes("ÿ���")
    || value.includes("鈥?")
    || value.includes("鍊煎緱鍏虫敞")
    || /(^|\n)pm\.cmd (?:test|run)/u.test(value);
}

export const SKILL_NAME = "ai-growth-intelligence";

// The release version lives in package.json alone. Everything else is checked
// for agreement with it, so a version bump cannot break its own guard rails.
export function validateIdentityDocuments({ packageJson, packageLock, skill, openai }) {
  const findings = [];
  const version = packageJson?.version;
  if (packageJson?.name !== SKILL_NAME) findings.push(`package.json name must be ${SKILL_NAME}`);
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) {
    findings.push("package.json version must be a semantic X.Y.Z version");
    return findings;
  }
  const versionPattern = version.replaceAll(".", String.raw`\.`);
  if (packageLock?.name !== packageJson?.name || packageLock?.version !== version) findings.push("package-lock.json top-level identity mismatch");
  if (packageLock?.packages?.[""]?.name !== packageJson?.name || packageLock?.packages?.[""]?.version !== version) findings.push("package-lock.json root package identity mismatch");
  if (!new RegExp(`^name: ${SKILL_NAME}$`, "mu").test(skill)) findings.push(`SKILL.md name is not ${SKILL_NAME}`);
  if (!new RegExp(`^  slug: ${SKILL_NAME}$`, "mu").test(skill)) findings.push(`SKILL.md metadata.slug is not ${SKILL_NAME}`);
  if (!new RegExp(`^  version: "${versionPattern}"$`, "mu").test(skill)) findings.push(`SKILL.md version does not match package.json (${version})`);
  if (!openai.includes(`$${SKILL_NAME}`)) findings.push(`agents/openai.yaml does not reference $${SKILL_NAME}`);
  return findings;
}

function isRuntimeFile(root, filePath) {
  const relative = path.relative(root, filePath).replaceAll("\\", "/");
  return relative === "SKILL.md"
    || relative === "package.json"
    || relative === "package-lock.json"
    || relative === "config.example.json"
    || relative.startsWith("src/")
    || relative.startsWith("tests/")
    || (relative.startsWith("scripts/") && !relative.startsWith("scripts/self-check"))
    || relative.startsWith("agents/")
    || relative.startsWith("references/");
}

export function performSelfCheck(root) {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(path.join(root, file)));
  if (missing.length) throw new Error(`Missing required files: ${missing.join(", ")}`);
  const unexpected = REMOVED_WEB_ARTIFACTS.filter((file) => existsSync(path.join(root, file)));
  if (unexpected.length) throw new Error(`Removed webpage artifacts still exist: ${unexpected.join(", ")}`);

  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const identityFindings = validateIdentityDocuments({
    packageJson,
    packageLock,
    skill: readFileSync(path.join(root, "SKILL.md"), "utf8"),
    openai: readFileSync(path.join(root, "agents", "openai.yaml"), "utf8"),
  });
  if (identityFindings.length) throw new Error(`Active identity mismatch:\n${identityFindings.join("\n")}`);

  const files = collectTextCandidateFiles(root);
  const findings = [];
  let scannedFiles = 0;
  for (const filePath of files) {
    const content = readLikelyText(filePath);
    if (content === null) continue;
    scannedFiles += 1;
    if (isRuntimeFile(root, filePath)) {
      for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
        if (content.includes(pattern)) findings.push(`${path.relative(root, filePath)} contains forbidden pattern ${pattern}`);
      }
    }
    if (containsGitHubCredential(content)) findings.push(`${path.relative(root, filePath)} contains a possible GitHub credential`);
    if (containsSkillHubCredential(content)) findings.push(`${path.relative(root, filePath)} contains a possible SkillHub credential`);
    if (containsWechatCredential(content)) findings.push(`${path.relative(root, filePath)} contains a possible WeChat app secret`);
  }
  for (const relative of ACTIVE_CONTROL_DOCUMENTS) {
    const controlPath = path.join(root, relative);
    if (!existsSync(controlPath)) continue;
    const content = readFileSync(controlPath, "utf8");
    if (detectDamagedUnicode(content)) findings.push(`${relative} contains damaged Unicode or command text`);
  }
  if (findings.length) throw new Error(`Self-check findings:\n${findings.join("\n")}`);
  return { scannedFiles };
}
