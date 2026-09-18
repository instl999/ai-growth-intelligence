/**
 * WeChat Official Account client, scoped to the draft box.
 *
 * This class deliberately exposes no publish, mass-send, or scheduled-send
 * call. The widest outcome it can produce is a draft sitting in the account's
 * draft box waiting for a person to review and publish it by hand. Keeping the
 * capability absent from the client is the safety boundary; a configuration
 * flag could be flipped, a missing method cannot.
 *
 * Credentials arrive as constructor arguments from the host environment and are
 * never logged, returned, or written to disk.
 */

const API_BASE = "https://api.weixin.qq.com";

export class WechatApiError extends Error {
  constructor(message, code = "wechat_api_error", details = {}) {
    super(message);
    this.name = "WechatApiError";
    this.code = code;
    this.details = details;
  }
}

/** Remove anything credential-shaped from text before it reaches a log or a result. */
export function redactWechatSecrets(value, ...secrets) {
  let text = typeof value === "string" ? value : String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) text = text.replaceAll(secret, "[redacted]");
  }
  return text
    .replace(/(access_token=)[A-Za-z0-9._-]+/gu, "$1[redacted]")
    .replace(/(secret=)[A-Za-z0-9]+/gu, "$1[redacted]")
    .replace(/\b[0-9a-f]{32}\b/gu, "[redacted]");
}

function assertOk(payload, action, secrets) {
  const code = payload?.errcode;
  if (code === undefined || code === 0) return payload;
  const message = redactWechatSecrets(payload?.errmsg ?? "unknown error", ...secrets);
  throw new WechatApiError(`WeChat ${action} failed (errcode ${code}): ${message}`, "wechat_api_rejected", {
    errcode: code,
    errmsg: message,
  });
}

export class WechatDraftClient {
  /**
   * @param {object} options
   * @param {string} options.appId
   * @param {string} options.appSecret
   * @param {Function} [options.fetchImpl]  Injectable for tests.
   * @param {Function} [options.now]
   */
  constructor({ appId, appSecret, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    if (typeof appId !== "string" || !appId.trim()) throw new TypeError("A WeChat appId is required.");
    if (typeof appSecret !== "string" || !appSecret.trim()) throw new TypeError("A WeChat appSecret is required.");
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
    this.appId = appId.trim();
    this.appSecret = appSecret.trim();
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.tokenCache = null;
    this.calls = [];
  }

  get secrets() {
    return [this.appSecret, this.tokenCache?.token].filter(Boolean);
  }

  async #json(response, action) {
    const text = await response.text();
    if (!response.ok) {
      throw new WechatApiError(
        `WeChat ${action} returned HTTP ${response.status}: ${redactWechatSecrets(text.slice(0, 200), ...this.secrets)}`,
        "wechat_http_error",
        { status: response.status },
      );
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new WechatApiError(`WeChat ${action} returned a non-JSON response.`, "wechat_invalid_response");
    }
    return assertOk(payload, action, this.secrets);
  }

  /** Fetch and cache an access token. Refreshed 5 minutes before expiry. */
  async getAccessToken() {
    if (this.tokenCache && this.tokenCache.expiresAt > this.now()) return this.tokenCache.token;
    const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
    this.calls.push("token");
    const payload = await this.#json(await this.fetchImpl(url, { method: "GET" }), "token request");
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new WechatApiError("WeChat did not return an access token.", "wechat_missing_token");
    }
    const lifetimeMs = Math.max(60, Number(payload.expires_in ?? 7200) - 300) * 1000;
    this.tokenCache = { token: payload.access_token, expiresAt: this.now() + lifetimeMs };
    return this.tokenCache.token;
  }

  /**
   * Upload a permanent image and return its media_id, usable as an article cover.
   * @param {Buffer|Uint8Array} bytes
   * @param {string} filename
   */
  async uploadPermanentImage(bytes, filename = "cover.png") {
    if (!bytes?.length) throw new TypeError("Cover image bytes are required.");
    const token = await this.getAccessToken();
    const form = new FormData();
    form.append("media", new Blob([bytes], { type: "image/png" }), filename);
    this.calls.push("upload_permanent_image");
    const payload = await this.#json(
      await this.fetchImpl(`${API_BASE}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`, {
        method: "POST",
        body: form,
      }),
      "permanent material upload",
    );
    if (typeof payload.media_id !== "string" || !payload.media_id) {
      throw new WechatApiError("WeChat did not return a media_id for the cover image.", "wechat_missing_media_id");
    }
    return { mediaId: payload.media_id, url: typeof payload.url === "string" ? payload.url : null };
  }

  /**
   * Create one draft article. This is the only write this client can perform.
   * @returns {{mediaId: string}} The draft's media_id.
   */
  async addDraft(article) {
    const token = await this.getAccessToken();
    this.calls.push("add_draft");
    const payload = await this.#json(
      await this.fetchImpl(`${API_BASE}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ articles: [article] }),
      }),
      "draft creation",
    );
    if (typeof payload.media_id !== "string" || !payload.media_id) {
      throw new WechatApiError("WeChat did not return a draft media_id.", "wechat_missing_draft_id");
    }
    return { mediaId: payload.media_id };
  }
}
