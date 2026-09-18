import { DEFAULT_GITHUB_API_VERSION, GITHUB_TOKEN_ENV_VAR } from "./metadata.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const PUBLIC_GITHUB_API_ORIGIN = "https://api.github.com";

function positiveInteger(value, fieldName, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive safe integer.`);
  return number;
}

function encodePathPart(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${fieldName} must be a non-empty string.`);
  return encodeURIComponent(value.trim());
}

function repositoryPath(owner, repo, suffix = "") {
  return `/repos/${encodePathPart(owner, "owner")}/${encodePathPart(repo, "repo")}${suffix}`;
}

function parseResponseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function redactSecret(message, secret) {
  let safe = String(message ?? "GitHub API request failed.");
  if (secret) safe = safe.replaceAll(secret, "[REDACTED]");
  return safe.replace(/(?:github_pat_|gh[pousrue]_)[A-Za-z0-9_]{8,}/gu, "[REDACTED]");
}

export class GitHubApiError extends Error {
  constructor(message, { status = null, code = "github_api_error", retryAfter = null } = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class GitHubApiClient {
  constructor({
    token = process.env[GITHUB_TOKEN_ENV_VAR],
    fetchImpl = globalThis.fetch,
    apiBaseUrl = PUBLIC_GITHUB_API_ORIGIN,
    apiVersion = DEFAULT_GITHUB_API_VERSION,
    userAgent = "ai-growth-intelligence-github-auto-fork",
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
    this.token = typeof token === "string" && token.trim() ? token.trim() : null;
    this.fetchImpl = fetchImpl;
    this.apiBaseUrl = new URL(apiBaseUrl);
    if (this.apiBaseUrl.protocol !== "https:" || this.apiBaseUrl.username || this.apiBaseUrl.password) {
      throw new GitHubApiError("GitHub API base URL must be an HTTPS URL without embedded credentials.", { code: "unsafe_api_origin" });
    }
    if (this.token && this.apiBaseUrl.origin !== PUBLIC_GITHUB_API_ORIGIN) {
      throw new GitHubApiError("Authenticated requests are restricted to https://api.github.com.", { code: "unsafe_authenticated_api_origin" });
    }
    this.apiVersion = apiVersion;
    this.userAgent = userAgent;
    this.requestTimeoutMs = positiveInteger(requestTimeoutMs, "requestTimeoutMs", DEFAULT_REQUEST_TIMEOUT_MS);
  }

  hasAuthentication() {
    return Boolean(this.token);
  }

  async request(method, path, { query = {}, body, requiresAuth = false } = {}) {
    if (requiresAuth && !this.token) {
      throw new GitHubApiError(`A GitHub token is required. Set ${GITHUB_TOKEN_ENV_VAR} in the host environment.`, { status: 401, code: "missing_token" });
    }
    const url = new URL(path, this.apiBaseUrl);
    if (url.origin !== this.apiBaseUrl.origin) throw new GitHubApiError("Refusing to send a GitHub request to a different origin.", { code: "unsafe_request_origin" });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": this.apiVersion,
      "User-Agent": this.userAgent,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    let timeout;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new GitHubApiError("GitHub API request timed out.", { code: "request_timeout" }));
      }, this.requestTimeoutMs);
    });
    try {
      const fetchPromise = Promise.resolve().then(() => this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      }));
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      if (response?.redirected === true) throw new GitHubApiError("Refusing a redirected GitHub API response.", { code: "unsafe_redirect" });
      const data = parseResponseBody(await Promise.race([response.text(), timeoutPromise]));
      if (!response.ok) {
        const rawMessage = typeof data?.message === "string" ? data.message : `GitHub API returned HTTP ${response.status}.`;
        throw new GitHubApiError(redactSecret(rawMessage, this.token), {
          status: response.status,
          code: response.status === 403 ? "forbidden_or_rate_limited" : "github_api_error",
          retryAfter: response.headers?.get?.("retry-after") ?? null,
        });
      }
      return data;
    } catch (error) {
      if (error instanceof GitHubApiError) throw error;
      if (controller.signal.aborted || error?.name === "AbortError") throw new GitHubApiError("GitHub API request timed out.", { code: "request_timeout" });
      throw new GitHubApiError("GitHub API request failed.", { code: "network_error" });
    } finally {
      clearTimeout(timeout);
    }
  }

  getAuthenticatedUser() {
    return this.request("GET", "/user", { requiresAuth: true });
  }

  getRepository(owner, repo, { requiresAuth = false } = {}) {
    return this.request("GET", repositoryPath(owner, repo), { requiresAuth });
  }

  searchRepositories({ query, sort = "stars", order = "desc", perPage = 30, page = 1 } = {}) {
    if (typeof query !== "string" || !query.trim()) throw new TypeError("query must be a non-empty string.");
    return this.request("GET", "/search/repositories", {
      query: {
        q: query,
        sort,
        order,
        per_page: Math.min(100, positiveInteger(perPage, "perPage", 30)),
        page: positiveInteger(page, "page", 1),
      },
    });
  }

  async listOwnedRepositories({ perPage = 100, maxPages = 10 } = {}) {
    const validatedPerPage = Math.min(100, positiveInteger(perPage, "perPage", 100));
    const validatedMaxPages = positiveInteger(maxPages, "maxPages", 10);
    const repositories = [];
    for (let page = 1; page <= validatedMaxPages; page += 1) {
      const result = await this.request("GET", "/user/repos", {
        requiresAuth: true,
        query: { type: "owner", sort: "updated", direction: "desc", per_page: validatedPerPage, page },
      });
      if (!Array.isArray(result)) throw new GitHubApiError("GitHub returned an invalid owned-repository list.", { code: "invalid_response" });
      repositories.push(...result);
      if (result.length < validatedPerPage) return repositories;
      if (page === validatedMaxPages) {
        throw new GitHubApiError("Owned-repository pagination reached the configured safety limit.", { code: "owned_repository_list_truncated" });
      }
    }
    return repositories;
  }

  getRepositoryTopics(owner, repo, { requiresAuth = false } = {}) {
    return this.request("GET", repositoryPath(owner, repo, "/topics"), { requiresAuth });
  }

  createFork(owner, repo, { name } = {}) {
    return this.request("POST", repositoryPath(owner, repo, "/forks"), { body: name ? { name } : {}, requiresAuth: true });
  }

  updateRepository(owner, repo, { description } = {}) {
    if (typeof description !== "string" || !description.trim()) throw new TypeError("description must be a non-empty string.");
    return this.request("PATCH", repositoryPath(owner, repo), { body: { description }, requiresAuth: true });
  }

  replaceRepositoryTopics(owner, repo, names) {
    if (!Array.isArray(names)) throw new TypeError("names must be an array.");
    return this.request("PUT", repositoryPath(owner, repo, "/topics"), { body: { names }, requiresAuth: true });
  }

  async waitForRepository(owner, repo, { attempts = 6, delayMs = 1_000 } = {}) {
    const validatedAttempts = positiveInteger(attempts, "attempts", 6);
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new TypeError("delayMs must be a non-negative safe integer.");
    for (let attempt = 1; attempt <= validatedAttempts; attempt += 1) {
      try {
        return await this.getRepository(owner, repo, { requiresAuth: true });
      } catch (error) {
        if (!(error instanceof GitHubApiError) || error.status !== 404 || attempt === validatedAttempts) throw error;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new GitHubApiError("Fork did not become available within the configured wait period.", { code: "fork_timeout" });
  }
}

export function createGitHubApiClient(options = {}) {
  return new GitHubApiClient(options);
}
