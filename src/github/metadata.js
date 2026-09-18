const DAY_MS = 24 * 60 * 60 * 1000;

export const GITHUB_AUTOMATION_NAME = "github自动fork并整理";
export const GITHUB_TOKEN_ENV_VAR = "GITHUB_TOKEN";
export const DEFAULT_GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_REPOSITORY_DESCRIPTION_MAX_LENGTH = 350;
export const GITHUB_TOPIC_MAX_LENGTH = 50;
export const GITHUB_TOPIC_MAX_COUNT = 20;
export const GITHUB_SCAN_MAX_CANDIDATES = 100;
export const GITHUB_SCAN_MAX_FORKS_PER_RUN = 10;
export const GITHUB_SCAN_MAX_QUERIES = 10;
export const GITHUB_SCAN_MAX_KEYWORDS = 10;

export const DEFAULT_GITHUB_AUTO_FORK_CONFIG = Object.freeze({
  enabled: false,
  riskAcknowledged: false,
  dryRun: true,
  scan: Object.freeze({
    sinceDays: 7,
    minStars: 100,
    maxCandidates: 20,
    maxForksPerRun: 3,
    maxQueries: 4,
    perPage: 30,
    keywords: Object.freeze(["ai agents", "mcp", "openclaw", "codex"]),
  }),
  topics: Object.freeze({ maxTopics: GITHUB_TOPIC_MAX_COUNT }),
  schedule: Object.freeze({
    enabled: false,
    apply: false,
    timezone: "Asia/Shanghai",
    cron: "0 9 * * *",
  }),
});

export class GitHubMetadataError extends TypeError {
  constructor(message, code = "invalid_repository_metadata") {
    super(message);
    this.name = "GitHubMetadataError";
    this.code = code;
  }
}

function objectOrEmpty(value, fieldName) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object.`);
  return value;
}

function boundedInteger(value, fieldName, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function uniqueStrings(values, fieldName, { maxItems = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(values)) throw new TypeError(`${fieldName} must be an array.`);
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new TypeError(`${fieldName} must contain only non-empty strings.`);
  }
  const unique = [...new Set(values.map((value) => value.trim()))];
  if (unique.length > maxItems) throw new TypeError(`${fieldName} may contain at most ${maxItems} unique values.`);
  return unique;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requireDate(value, fieldName) {
  const date = validDate(value);
  if (!date) throw new TypeError(`${fieldName} must be a valid date.`);
  return date;
}

function escapeSearchTerm(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function isCanonicalRepositoryName(value) {
  return typeof value === "string" && /^[^/\s]+\/[^/\s]+$/u.test(value.trim());
}

function repositoryFullName(repository) {
  if (repository?.full_name !== undefined && repository?.full_name !== null) {
    return isCanonicalRepositoryName(repository.full_name) ? repository.full_name.trim().toLowerCase() : null;
  }
  const owner = repository?.owner?.login;
  const name = repository?.name;
  const combined = typeof owner === "string" && typeof name === "string" ? `${owner.trim()}/${name.trim()}` : null;
  return isCanonicalRepositoryName(combined) ? combined.toLowerCase() : null;
}

function codePointLength(value) {
  return [...value].length;
}

export function normalizeGitHubAutomationConfig(input = {}) {
  const root = objectOrEmpty(input, "config");
  const scan = objectOrEmpty(root.scan, "scan");
  const topics = objectOrEmpty(root.topics, "topics");
  const schedule = objectOrEmpty(root.schedule, "schedule");
  const keywords = uniqueStrings(scan.keywords ?? DEFAULT_GITHUB_AUTO_FORK_CONFIG.scan.keywords, "scan.keywords", {
    maxItems: GITHUB_SCAN_MAX_KEYWORDS,
  });
  const excludedRepositories = uniqueStrings(scan.excludedRepositories ?? [], "scan.excludedRepositories")
    .map((value) => value.toLowerCase());
  const excludedOwners = uniqueStrings(scan.excludedOwners ?? [], "scan.excludedOwners")
    .map((value) => value.toLowerCase());
  if (excludedRepositories.some((value) => !isCanonicalRepositoryName(value))) {
    throw new TypeError("scan.excludedRepositories must use owner/repository names.");
  }
  if (excludedOwners.some((value) => /[\s/]/u.test(value))) {
    throw new TypeError("scan.excludedOwners must contain owner names only.");
  }

  return {
    enabled: root.enabled === true,
    riskAcknowledged: root.riskAcknowledged === true,
    dryRun: root.dryRun !== false,
    scan: {
      sinceDays: boundedInteger(scan.sinceDays, "scan.sinceDays", DEFAULT_GITHUB_AUTO_FORK_CONFIG.scan.sinceDays, { minimum: 1, maximum: 3_650 }),
      minStars: boundedInteger(scan.minStars, "scan.minStars", DEFAULT_GITHUB_AUTO_FORK_CONFIG.scan.minStars, { minimum: 0 }),
      maxCandidates: boundedInteger(scan.maxCandidates, "scan.maxCandidates", DEFAULT_GITHUB_AUTO_FORK_CONFIG.scan.maxCandidates, { minimum: 1, maximum: GITHUB_SCAN_MAX_CANDIDATES }),
      maxForksPerRun: boundedInteger(scan.maxForksPerRun, "scan.maxForksPerRun", DEFAULT_GITHUB_AUTO_FORK_CONFIG.scan.maxForksPerRun, { minimum: 1, maximum: GITHUB_SCAN_MAX_FORKS_PER_RUN }),
      maxQueries: boundedInteger(scan.maxQueries, "scan.maxQueries", DEFAULT_GITHUB_AUTO_FORK_CONFIG.scan.maxQueries, { minimum: 1, maximum: GITHUB_SCAN_MAX_QUERIES }),
      perPage: boundedInteger(scan.perPage, "scan.perPage", DEFAULT_GITHUB_AUTO_FORK_CONFIG.scan.perPage, { minimum: 1, maximum: 100 }),
      keywords,
      excludedRepositories,
      excludedOwners,
    },
    topics: {
      maxTopics: boundedInteger(topics.maxTopics, "topics.maxTopics", DEFAULT_GITHUB_AUTO_FORK_CONFIG.topics.maxTopics, { minimum: 1, maximum: GITHUB_TOPIC_MAX_COUNT }),
    },
    schedule: {
      enabled: schedule.enabled === true,
      apply: schedule.apply === true,
      timezone: typeof schedule.timezone === "string" && schedule.timezone.trim() ? schedule.timezone.trim() : "Asia/Shanghai",
      cron: typeof schedule.cron === "string" && schedule.cron.trim() ? schedule.cron.trim() : "0 9 * * *",
    },
  };
}

export function buildHotRepositoryQuery({ sinceDays = 7, minStars = 100, keywords = [], now = new Date() } = {}) {
  const days = boundedInteger(sinceDays, "sinceDays", 7, { minimum: 1, maximum: 3_650 });
  const stars = boundedInteger(minStars, "minStars", 100, { minimum: 0 });
  const current = requireDate(now, "now");
  const terms = uniqueStrings(keywords, "keywords", { maxItems: GITHUB_SCAN_MAX_KEYWORDS });
  return [
    `stars:>=${stars}`,
    `pushed:>=${dateOnly(new Date(current.getTime() - days * DAY_MS))}`,
    "is:public",
    "archived:false",
    "fork:false",
    ...terms.map(escapeSearchTerm),
  ].join(" ");
}

export function buildHotRepositoryQueries({ scan = {}, now = new Date() } = {}) {
  const normalized = normalizeGitHubAutomationConfig({ scan });
  const terms = normalized.scan.keywords.slice(0, normalized.scan.maxQueries);
  return (terms.length ? terms : [null]).map((term) => ({
    query: buildHotRepositoryQuery({ ...normalized.scan, keywords: term === null ? [] : [term], now }),
    term,
    sort: "stars",
    order: "desc",
    perPage: normalized.scan.perPage,
  }));
}

export function scoreHotRepository(repository, { now = new Date() } = {}) {
  const current = requireDate(now, "now");
  const stars = Number(repository?.stargazers_count);
  const forks = Number(repository?.forks_count ?? 0);
  const pushedAt = validDate(repository?.pushed_at);
  if (!Number.isFinite(stars) || stars < 0 || !Number.isFinite(forks) || forks < 0 || !pushedAt) return 0;
  const ageDays = Math.max(0, (current.getTime() - pushedAt.getTime()) / DAY_MS);
  const recency = Math.max(0, 30 - Math.min(30, ageDays));
  return Math.round((Math.log1p(stars) * 10 + Math.log1p(forks) * 6 + recency) * 100) / 100;
}

export function isEligibleRepository(repository, { scan = {}, now = new Date() } = {}) {
  const normalized = normalizeGitHubAutomationConfig({ scan });
  const current = requireDate(now, "now");
  const fullName = repositoryFullName(repository);
  const reasons = [];
  const stars = Number(repository?.stargazers_count);
  const pushedAt = validDate(repository?.pushed_at);
  const explicitlyPublic = repository?.visibility === "public" || repository?.private === false;

  if (!fullName) reasons.push("missing_or_invalid_full_name");
  if (repository?.fork === true) reasons.push("source_is_fork");
  if (repository?.archived === true) reasons.push("archived");
  if (repository?.disabled === true) reasons.push("disabled");
  if (!explicitlyPublic || repository?.private === true || (repository?.visibility && repository.visibility !== "public")) reasons.push("not_public");
  if (!Number.isFinite(stars) || stars < 0) reasons.push("invalid_stars");
  else if (stars < normalized.scan.minStars) reasons.push("below_minimum_stars");
  if (!repository?.pushed_at) reasons.push("missing_pushed_at");
  else if (!pushedAt) reasons.push("invalid_pushed_at");
  else if (pushedAt.getTime() < current.getTime() - normalized.scan.sinceDays * DAY_MS) reasons.push("not_recently_pushed");

  if (fullName && normalized.scan.excludedRepositories.includes(fullName)) reasons.push("excluded_repository");
  const owner = fullName?.split("/", 1)[0];
  if (owner && normalized.scan.excludedOwners.includes(owner)) reasons.push("excluded_owner");
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], fullName };
}

export function evaluateHotRepositories(repositories = [], { scan = {}, now = new Date() } = {}) {
  if (!Array.isArray(repositories)) throw new TypeError("repositories must be an array.");
  const normalized = normalizeGitHubAutomationConfig({ scan });
  const seen = new Set();
  const eligible = [];
  const excluded = [];
  for (const repository of repositories) {
    const evaluation = isEligibleRepository(repository, { scan: normalized.scan, now });
    if (!evaluation.eligible) {
      excluded.push({ repository: sanitizeRepository(repository), reasons: evaluation.reasons });
      continue;
    }
    if (seen.has(evaluation.fullName)) {
      excluded.push({ repository: sanitizeRepository(repository), reasons: ["duplicate_query_result"] });
      continue;
    }
    seen.add(evaluation.fullName);
    eligible.push({ ...repository, full_name: repository.full_name ?? evaluation.fullName, hotnessScore: scoreHotRepository(repository, { now }) });
  }
  eligible.sort((left, right) => right.hotnessScore - left.hotnessScore || Number(right.stargazers_count) - Number(left.stargazers_count));
  const selected = eligible.slice(0, normalized.scan.maxCandidates);
  for (const repository of eligible.slice(normalized.scan.maxCandidates)) {
    excluded.push({ repository: sanitizeRepository(repository), reasons: ["candidate_limit"] });
  }
  return { repositories: selected, excluded };
}

export function rankHotRepositories(repositories = [], options = {}) {
  return evaluateHotRepositories(repositories, options).repositories;
}

export function composeOrganizedDescription({ chineseSummary, englishDescription } = {}) {
  if (typeof chineseSummary !== "string" || !chineseSummary.trim()) {
    throw new GitHubMetadataError("chineseSummary must be a non-empty string.", "missing_chinese_summary");
  }
  const summary = chineseSummary.trim().replace(/\s+/gu, " ");
  if (!/\p{Script=Han}/u.test(summary)) {
    throw new GitHubMetadataError("chineseSummary must contain Chinese characters.", "chinese_summary_required");
  }
  if (englishDescription !== undefined && englishDescription !== null && typeof englishDescription !== "string") {
    throw new GitHubMetadataError("Original English description must be a string or null.", "invalid_original_description");
  }
  const original = typeof englishDescription === "string" && englishDescription.length > 0
    ? englishDescription
    : "(original repository did not provide an English description)";
  const description = `中文简介：${summary} | English description: ${original}`;
  if (codePointLength(description) > GITHUB_REPOSITORY_DESCRIPTION_MAX_LENGTH) {
    throw new GitHubMetadataError(`Combined repository description exceeds ${GITHUB_REPOSITORY_DESCRIPTION_MAX_LENGTH} characters.`, "description_too_long");
  }
  return description;
}

export function normalizeEnglishTopic(value) {
  if (typeof value !== "string" || !value.trim()) throw new GitHubMetadataError("English topic must be a non-empty string.", "invalid_topic");
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)) throw new GitHubMetadataError(`Invalid English topic: ${value}`, "invalid_topic");
  if (codePointLength(normalized) > GITHUB_TOPIC_MAX_LENGTH) {
    throw new GitHubMetadataError(`GitHub topic exceeds ${GITHUB_TOPIC_MAX_LENGTH} characters: ${value}`, "topic_too_long");
  }
  return normalized;
}

export function mergeRepositoryTopics(existingTopics = [], englishTags = [], maxTopics = GITHUB_TOPIC_MAX_COUNT) {
  if (!Array.isArray(existingTopics)) throw new GitHubMetadataError("existingTopics must be an array.", "invalid_existing_topics");
  if (!Array.isArray(englishTags)) throw new GitHubMetadataError("englishTags must be an array.", "invalid_english_tags");
  if (englishTags.length === 0) throw new GitHubMetadataError("At least one English topic is required.", "english_topics_required");
  const limit = boundedInteger(maxTopics, "maxTopics", GITHUB_TOPIC_MAX_COUNT, { minimum: 1, maximum: GITHUB_TOPIC_MAX_COUNT });
  const merged = [...new Set([...existingTopics.map(normalizeEnglishTopic), ...englishTags.map(normalizeEnglishTopic)])];
  if (merged.length > limit) {
    throw new GitHubMetadataError(`Preserving existing topics and adding the requested topics would exceed the ${limit}-topic limit.`, "topic_capacity_exceeded");
  }
  return merged;
}

export function prepareRepositoryMetadata(repository, { chineseSummary, englishTags, maxTopics = GITHUB_TOPIC_MAX_COUNT } = {}) {
  const description = composeOrganizedDescription({ chineseSummary, englishDescription: repository?.description });
  const topics = mergeRepositoryTopics(repository?.topics ?? [], englishTags, maxTopics);
  return {
    description,
    topics,
    originalDescription: repository?.description ?? null,
    chineseSummary: chineseSummary.trim().replace(/\s+/gu, " "),
    englishTags: [...new Set(englishTags.map(normalizeEnglishTopic))],
  };
}

export function repositoryKey(repository) {
  const key = repositoryFullName(repository);
  if (!key) throw new TypeError("Repository must include a canonical owner/repository name.");
  return key;
}

export function sanitizeRepository(repository) {
  const stars = Number(repository?.stargazers_count);
  const forks = Number(repository?.forks_count);
  const hotnessScore = Number(repository?.hotnessScore);
  return {
    id: Number.isSafeInteger(repository?.id) ? repository.id : null,
    fullName: repositoryFullName(repository),
    htmlUrl: typeof repository?.html_url === "string" ? repository.html_url : null,
    description: typeof repository?.description === "string" ? repository.description : repository?.description ?? null,
    stars: Number.isFinite(stars) ? stars : null,
    forks: Number.isFinite(forks) ? forks : null,
    pushedAt: typeof repository?.pushed_at === "string" ? repository.pushed_at : null,
    updatedAt: typeof repository?.updated_at === "string" ? repository.updated_at : null,
    license: repository?.license?.spdx_id ?? repository?.license?.key ?? null,
    hotnessScore: Number.isFinite(hotnessScore) ? hotnessScore : null,
    visibility: repository?.visibility ?? (repository?.private === false ? "public" : null),
  };
}
