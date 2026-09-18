import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { Surface, PNG_SIGNATURE } from "../src/wechat/png.js";
import { renderCover, selectPalette, measureText } from "../src/wechat/cover.js";
import { buildDigest, buildTitle, markdownToWechatHtml } from "../src/wechat/html.js";
import { LINE_MARKERS } from "../src/core/article-composer.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WechatApiError, WechatDraftClient, redactWechatSecrets } from "../src/wechat/api-client.js";
import { CoverMaterialCache, hashCover } from "../src/wechat/cover-cache.js";
import {
  coverTagsFromMarkdown,
  getWechatDraftSafetyContract,
  normalizeWechatDraftConfig,
  prepareWechatDraft,
  pushBriefingToWechatDraft,
  resolveWechatCredentials,
} from "../src/wechat/draft.js";

const APP_ID = "wx1234567890abcdef";
// Built by concatenation so no literal secret-shaped string sits in the repo.
const APP_SECRET = `${"0123456789abcdef"}${"0123456789abcdef"}`;
const ENV = { WECHAT_APP_ID: APP_ID, WECHAT_APP_SECRET: APP_SECRET };

const markdown = [
  "# 9月6日 AI 成长情报：GitHub 精选、AI 情报",
  "",
  "本期筛选出 10 条可验证的高价值情报。",
  "",
  "## GitHub 精选（5 条）",
  "",
  "### 1. 一个很有用的项目",
  "- **为什么值得关注：** 它能减少重复工作。",
  "- **来源：** [Example：Official launch](https://example.com/a)",
  "",
  "## AI 情报（5 条）",
  "",
  "### 1. 某个 AI 更新",
  "- **建议行动：** 先在一个任务上试用。",
  "",
  "> 财经内容仅供信息参考，不构成任何投资建议。",
].join("\n");

const article = {
  title: "9月6日 AI 成长情报：GitHub 精选、AI 情报",
  digest: "本期筛选出 10 条可验证的高价值情报。",
  markdown,
};

function enabled(overrides = {}) {
  return { wechatDraftBox: { enabled: true, dryRun: false, ...overrides } };
}

// -- PNG encoder -------------------------------------------------------------

test("the PNG encoder emits a structurally valid truecolour image", () => {
  const surface = new Surface(6, 4);
  surface.fillRect(0, 0, 6, 4, [10, 20, 30]);
  const png = surface.toPng();
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  const ihdr = png.subarray(16, 29);
  assert.equal(ihdr.readUInt32BE(0), 6);
  assert.equal(ihdr.readUInt32BE(4), 4);
  assert.equal(ihdr[8], 8, "bit depth");
  assert.equal(ihdr[9], 2, "truecolour");

  const table = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  const crc = (buffer) => {
    let c = -1;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    assert.equal(crc(png.subarray(offset + 4, offset + 8 + length)), png.readUInt32BE(offset + 8 + length));
    offset += 12 + length;
  }
});

test("scanlines decompress to the pixels that were drawn", () => {
  const surface = new Surface(2, 1);
  surface.set(0, 0, [1, 2, 3]);
  surface.set(1, 0, [4, 5, 6]);
  const png = surface.toPng();
  const idatOffset = 8 + 12 + 13;
  const idat = png.subarray(idatOffset + 8, idatOffset + 8 + png.readUInt32BE(idatOffset));
  assert.deepEqual([...inflateSync(idat)], [0, 1, 2, 3, 4, 5, 6]);
});

test("alpha blending composites toward the source colour", () => {
  const surface = new Surface(1, 1);
  surface.set(0, 0, [0, 0, 0]);
  surface.blend(0, 0, [200, 100, 50], 0.5);
  assert.deepEqual(surface.get(0, 0), [100, 50, 25]);
});

test("drawing outside the surface is ignored rather than throwing", () => {
  const surface = new Surface(2, 2);
  assert.doesNotThrow(() => {
    surface.set(-1, 0, [1, 2, 3]);
    surface.blend(9, 9, [1, 2, 3], 1);
    surface.fillRect(-5, -5, 3, 3, [1, 2, 3]);
  });
});

// -- cover -------------------------------------------------------------------

test("the cover is deterministic for a seed and varies across seeds", () => {
  const first = renderCover({ seed: "briefing-a" }).png;
  const second = renderCover({ seed: "briefing-a" }).png;
  assert.ok(first.equals(second));
  assert.ok(!first.equals(renderCover({ seed: "briefing-b" }).png));
});

test("the cover uses WeChat's recommended proportions and a curated palette", () => {
  const { png, palette, width, height } = renderCover({ seed: "x", dateLabel: "2026.09.06", tags: ["AI"] });
  assert.equal(width, 900);
  assert.equal(height, 383);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.equal(palette, selectPalette("x"));
  assert.ok(png.length < 400 * 1024, "cover stays well under WeChat's 10 MB image limit");
});

test("text measurement matches the glyph grid", () => {
  assert.equal(measureText("AI", { scale: 2 }).width, 2 * 5 * 2 + 1 * 2);
  assert.equal(measureText("", { scale: 2 }).width, 0);
});

test("unsupported characters advance the cursor instead of throwing", () => {
  assert.doesNotThrow(() => renderCover({ seed: "s", wordmark: "情报 AI", dateLabel: "2026.09.06" }));
});

// -- markdown to HTML --------------------------------------------------------

test("the H1 is dropped because WeChat carries the title separately", () => {
  const html = markdownToWechatHtml(markdown);
  assert.ok(!html.includes("<h1"));
  assert.ok(html.includes("<h2"));
  assert.ok(html.includes("<h3"));
});

test("every rule is an inline style, since WeChat strips stylesheets", () => {
  const html = markdownToWechatHtml(markdown);
  assert.ok(!/<style|class=/u.test(html));
  assert.ok(html.includes('style="'));
});

test("source URLs stay visible as text because external links are not tappable", () => {
  const html = markdownToWechatHtml(markdown);
  assert.ok(html.includes("https://example.com/a"));
  assert.ok(!html.includes("<a href"));
});

test("anchor mode is available for accounts that whitelisted their domains", () => {
  const html = markdownToWechatHtml(markdown, { linkStyle: "anchor" });
  assert.ok(html.includes('<a href="https://example.com/a"'));
});

test("HTML metacharacters and non-http links cannot inject markup", () => {
  const html = markdownToWechatHtml('- **风险：** <script>alert(1)</script> 与 [x](javascript:alert(1))');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("javascript:"));
});

test("markdown escaping applied by the composer is undone in the HTML", () => {
  assert.ok(markdownToWechatHtml("- 名称 A\\_B\\*C").includes("A_B*C"));
});

test("each marked line gets the block its role calls for", () => {
  const html = markdownToWechatHtml([
    "正文段落。",
    "",
    `${LINE_MARKERS.tool} 工具｜功能｜价格：免费`,
    "",
    `${LINE_MARKERS.source} [来源：标题](https://example.com/a)`,
  ].join("\n"));
  const styleOf = (marker) => html.match(new RegExp(`<p style="([^"]+)">${marker}`, "u"))?.[1];
  const tool = styleOf(LINE_MARKERS.tool);
  const source = styleOf(LINE_MARKERS.source);
  // Reference detail is boxed and sources recede, so the two must not collapse
  // into the same style as each other or as body prose.
  assert.equal(new Set([tool, source]).size, 2);
  assert.match(tool, /border:1px solid/u);
  assert.match(source, /font-size:13px/u);
  assert.ok(html.includes("<p style=\"margin:0 0 14px;\">正文段落。</p>"), "unmarked prose stays a plain paragraph");
});

test("a 速览 entry is tight and borderless, a labelled brief line is not", () => {
  const indexHtml = markdownToWechatHtml("- 🧠 今天的一条标题");
  const briefHtml = markdownToWechatHtml("- **为什么值得关注：** 因为它有用。");
  assert.match(indexHtml, /<p style="margin:0 0 9px;[^"]*">/u);
  assert.doesNotMatch(indexHtml, /border-left/u);
  assert.match(briefHtml, /border-left:2px solid/u);
});

test("the first paragraph is a byline in an article and a summary card in a brief", () => {
  const doc = "# 标题\n\nAI 成长情报 · 9月8日 · 今天 10 条";
  assert.match(markdownToWechatHtml(doc), /<p style="[^"]*color:#9aa2ab;">AI 成长情报/u);
  assert.match(markdownToWechatHtml(doc, { style: "brief" }), /<p style="[^"]*background:#f4f6f8[^"]*">AI 成长情报/u);
});

test("an entry separator renders as a divider, not as literal dashes", () => {
  const html = markdownToWechatHtml("第一条。\n\n---\n\n第二条。");
  assert.ok(!html.includes("---"), "WeChat drops <hr>, so the rule is a styled empty section");
  assert.match(html, /<section style="[^"]*border-top:1px solid #eceff2;"><\/section>/u);
});

test("cover tags survive a decorated section heading", () => {
  assert.deepEqual(coverTagsFromMarkdown("## 🛠 GitHub 精选\n\n## 🧩 Skill 精选"), ["GITHUB", "SKILL"]);
  assert.deepEqual(coverTagsFromMarkdown("正文里提到 GitHub 精选，但那不是版块标题"), []);
});

test("title and digest respect WeChat's length limits", () => {
  assert.equal(buildTitle("a".repeat(80)).length, 64);
  assert.equal(buildDigest("b".repeat(200)).length, 120);
  assert.equal(buildTitle("  正常标题  "), "正常标题");
  assert.throws(() => buildTitle("   "), TypeError);
});

// -- configuration and safety ------------------------------------------------

test("the feature is disabled and dry-run by default", () => {
  const config = normalizeWechatDraftConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.dryRun, true);
});

test("credentials in a configuration file are rejected outright", () => {
  assert.throws(
    () => normalizeWechatDraftConfig({ wechatDraftBox: { enabled: true, appSecret: APP_SECRET } }),
    (error) => error.code === "credentials_in_config",
  );
  assert.throws(
    () => normalizeWechatDraftConfig({ wechatDraftBox: { enabled: true, nested: { accessToken: "x" } } }),
    (error) => error.code === "credentials_in_config",
  );
});

test("invalid configuration values are refused", () => {
  assert.throws(() => normalizeWechatDraftConfig({ wechatDraftBox: { linkStyle: "iframe" } }), /linkStyle/u);
  assert.throws(() => normalizeWechatDraftConfig({ wechatDraftBox: { sourceUrl: "ftp://x/y" } }), /sourceUrl/u);
});

test("the safety contract names the draft box as the widest possible outcome", () => {
  const contract = getWechatDraftSafetyContract({});
  assert.equal(contract.enabled, false);
  assert.deepEqual(contract.credentialsFrom, ["WECHAT_APP_ID", "WECHAT_APP_SECRET"]);
  assert.equal(contract.credentialsInConfig, "rejected");
  assert.ok(contract.forbiddenOperations.includes("publishing an article"));
  assert.ok(contract.forbiddenOperations.includes("mass sending to followers"));
});

test("the client exposes no way to publish or mass-send", () => {
  const client = new WechatDraftClient({ appId: APP_ID, appSecret: APP_SECRET, fetchImpl: async () => {} });
  const surface = new Set([
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(client)),
    ...Object.getOwnPropertyNames(client),
  ]);
  for (const forbidden of ["publish", "send", "massSend", "sendAll", "submit", "schedule", "delete"]) {
    assert.ok(![...surface].some((name) => name.toLowerCase().includes(forbidden)), `client must not expose ${forbidden}`);
  }
});

test("credential material is redacted from any text that escapes", () => {
  const text = `failed with secret=${APP_SECRET} and access_token=ABCdef-123_456`;
  const redacted = redactWechatSecrets(text, APP_SECRET);
  assert.ok(!redacted.includes(APP_SECRET));
  assert.ok(!redacted.includes("ABCdef-123_456"));
});

test("missing credentials are reported by name", () => {
  const resolved = resolveWechatCredentials({ WECHAT_APP_ID: APP_ID });
  assert.equal(resolved.available, false);
  assert.deepEqual(resolved.missing, ["WECHAT_APP_SECRET"]);
});

// -- preparation -------------------------------------------------------------

test("preparation derives cover tags from the briefing's own sections", () => {
  assert.deepEqual(coverTagsFromMarkdown(markdown), ["GITHUB", "AI"]);
});

test("the prepared article carries no cover id until one is uploaded", () => {
  const prepared = prepareWechatDraft({ article, config: enabled() });
  assert.equal(prepared.article.thumb_media_id, undefined);
  assert.equal(prepared.title, article.title);
  assert.ok(prepared.html.includes("<h2"));
  assert.ok(prepared.cover.png.length > 0);
});

test("comment settings are off unless explicitly enabled", () => {
  const off = prepareWechatDraft({ article, config: enabled() });
  assert.equal(off.article.need_open_comment, 0);
  const on = prepareWechatDraft({ article, config: enabled({ openComment: true }) });
  assert.equal(on.article.need_open_comment, 1);
});

// -- push flow ---------------------------------------------------------------

function recordingClient(responses = {}) {
  return {
    calls: [],
    async uploadPermanentImage(bytes, filename) {
      this.calls.push(["upload", bytes.length, filename]);
      if (responses.uploadError) throw responses.uploadError;
      return { mediaId: "cover-media-id", url: null };
    },
    async addDraft(payload) {
      this.calls.push(["draft", payload]);
      if (responses.draftError) throw responses.draftError;
      return { mediaId: "draft-media-id" };
    },
  };
}

test("a disabled feature performs no work and constructs no client", async () => {
  const result = await pushBriefingToWechatDraft({
    article,
    config: { wechatDraftBox: { enabled: false } },
    mode: "apply",
    env: ENV,
    clientFactory: () => {
      throw new Error("must not construct a client");
    },
  });
  assert.equal(result.status, "disabled");
  assert.equal(result.written, false);
});

test("a dry run renders everything and contacts WeChat not at all", async () => {
  let constructed = 0;
  const result = await pushBriefingToWechatDraft({
    article,
    config: enabled(),
    mode: "dry_run",
    env: ENV,
    clientFactory: () => {
      constructed += 1;
      return recordingClient();
    },
  });
  assert.equal(result.status, "dry_run");
  assert.equal(result.written, false);
  assert.equal(constructed, 0);
  assert.ok(result.coverBytes > 0);
  assert.ok(result.html.includes("<h2"));
});

test("dryRun left true in config blocks an apply run", async () => {
  const result = await pushBriefingToWechatDraft({
    article,
    config: { wechatDraftBox: { enabled: true, dryRun: true } },
    mode: "apply",
    env: ENV,
    clientFactory: () => {
      throw new Error("must not construct a client");
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "dry_run_locked_in_config");
});

test("apply without credentials stops before constructing a client", async () => {
  const result = await pushBriefingToWechatDraft({
    article,
    config: enabled(),
    mode: "apply",
    env: {},
    clientFactory: () => {
      throw new Error("must not construct a client");
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "missing_credentials");
  assert.deepEqual(result.missing, ["WECHAT_APP_ID", "WECHAT_APP_SECRET"]);
});

test("apply uploads the cover, then creates exactly one draft", async () => {
  const client = recordingClient();
  const result = await pushBriefingToWechatDraft({
    article,
    config: enabled({ author: "编辑部", sourceUrl: "https://example.com/archive" }),
    mode: "apply",
    env: ENV,
    clientFactory: () => client,
  });
  assert.equal(result.status, "created");
  assert.equal(result.written, true);
  assert.equal(result.draftMediaId, "draft-media-id");
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0][0], "upload");
  const [, payload] = client.calls[1];
  assert.equal(payload.thumb_media_id, "cover-media-id");
  assert.equal(payload.author, "编辑部");
  assert.equal(payload.content_source_url, "https://example.com/archive");
  assert.ok(payload.content.includes("<h2"));
});

test("a failure after the cover upload reports what was already written", async () => {
  const failure = Object.assign(new Error(`rejected with secret=${APP_SECRET}`), { code: "wechat_api_rejected" });
  const result = await pushBriefingToWechatDraft({
    article,
    config: enabled(),
    mode: "apply",
    env: ENV,
    clientFactory: () => recordingClient({ draftError: failure }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.written, true, "the uploaded cover is a real side effect");
  assert.equal(result.coverMediaId, "cover-media-id");
  assert.ok(!JSON.stringify(result).includes(APP_SECRET));
});

test("an invalid mode is refused", async () => {
  await assert.rejects(
    () => pushBriefingToWechatDraft({ article, config: enabled(), mode: "publish", env: ENV }),
    /mode must be dry_run or apply/u,
  );
});

// -- transport ---------------------------------------------------------------

test("the token is cached and reused across calls", async () => {
  let tokenRequests = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/cgi-bin/token")) {
      tokenRequests += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "tok", expires_in: 7200 }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ media_id: "m" }) };
  };
  const client = new WechatDraftClient({ appId: APP_ID, appSecret: APP_SECRET, fetchImpl });
  await client.getAccessToken();
  await client.getAccessToken();
  assert.equal(tokenRequests, 1);
});

test("a WeChat errcode becomes a typed error with the secret stripped", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ errcode: 40013, errmsg: `invalid appid secret=${APP_SECRET}` }),
  });
  const client = new WechatDraftClient({ appId: APP_ID, appSecret: APP_SECRET, fetchImpl });
  await assert.rejects(() => client.getAccessToken(), (error) => {
    assert.equal(error.code, "wechat_api_rejected");
    assert.ok(!error.message.includes(APP_SECRET));
    return true;
  });
});

test("a non-JSON response is reported rather than parsed loosely", async () => {
  const client = new WechatDraftClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<html>gateway</html>" }),
  });
  await assert.rejects(() => client.getAccessToken(), (error) => error.code === "wechat_invalid_response");
});

test("the draft endpoint receives one article and a UTF-8 JSON content type", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.includes("/cgi-bin/token")) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "tok", expires_in: 7200 }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ media_id: "draft" }) };
  };
  const client = new WechatDraftClient({ appId: APP_ID, appSecret: APP_SECRET, fetchImpl });
  await client.addDraft({ title: "标题", content: "<p>正文</p>", thumb_media_id: "c" });
  const draftCall = seen.at(-1);
  assert.ok(draftCall.url.includes("/cgi-bin/draft/add"));
  assert.match(draftCall.init.headers["content-type"], /utf-8/u);
  const body = JSON.parse(draftCall.init.body);
  assert.equal(body.articles.length, 1);
  assert.equal(body.articles[0].title, "标题");
});

test("an over-long article is refused instead of silently truncated", () => {
  const bulky = { ...article, markdown: `${markdown}\n\n${"- **说明：** 很长的一段内容。\n".repeat(1200)}` };
  assert.throws(
    () => prepareWechatDraft({ article: bulky, config: enabled() }),
    (error) => {
      assert.equal(error.code, "content_too_long");
      assert.match(error.message, /over WeChat's 20000 limit/u);
      return true;
    },
  );
});

test("the contract publishes the field limits it enforces", () => {
  assert.deepEqual(getWechatDraftSafetyContract({}).limits, {
    titleCharacters: 64,
    digestCharacters: 120,
    contentCharacters: 20_000,
  });
});

// -- cover material reuse ----------------------------------------------------

test("an identical cover is uploaded once and reused on the next run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wechat-cover-cache-"));
  try {
    const cache = new CoverMaterialCache(path.join(directory, "cache.json"));
    const first = recordingClient();
    const a = await pushBriefingToWechatDraft({
      article, config: enabled(), mode: "apply", env: ENV, coverCache: cache, clientFactory: () => first,
    });
    assert.equal(a.status, "created");
    assert.equal(a.coverReused, false);
    assert.equal(first.calls.filter(([kind]) => kind === "upload").length, 1);

    const second = recordingClient();
    const b = await pushBriefingToWechatDraft({
      article, config: enabled(), mode: "apply", env: ENV, coverCache: cache, clientFactory: () => second,
    });
    assert.equal(b.status, "created");
    assert.equal(b.coverReused, true, "the second run must not spend another material slot");
    assert.equal(second.calls.filter(([kind]) => kind === "upload").length, 0);
    assert.equal(b.coverMediaId, a.coverMediaId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cover deleted in the console is re-uploaded once, not reported as broken", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wechat-cover-stale-"));
  try {
    const cache = new CoverMaterialCache(path.join(directory, "cache.json"));
    await cache.remember(hashCover(prepareWechatDraft({ article, config: enabled() }).cover.png), "GONE");

    let draftAttempts = 0;
    const client = {
      calls: [],
      async uploadPermanentImage() {
        this.calls.push(["upload"]);
        return { mediaId: "FRESH", url: null };
      },
      async addDraft(payload) {
        this.calls.push(["draft", payload.thumb_media_id]);
        draftAttempts += 1;
        if (payload.thumb_media_id === "GONE") {
          throw new WechatApiError("invalid media_id", "wechat_api_rejected", { errcode: 40007 });
        }
        return { mediaId: "DRAFT" };
      },
    };
    const result = await pushBriefingToWechatDraft({
      article, config: enabled(), mode: "apply", env: ENV, coverCache: cache, clientFactory: () => client,
    });
    assert.equal(result.status, "created");
    assert.equal(result.coverMediaId, "FRESH");
    assert.equal(result.coverReused, false);
    assert.equal(draftAttempts, 2);
    assert.equal(await cache.lookup(hashCover(prepareWechatDraft({ article, config: enabled() }).cover.png)), "FRESH");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a non-media failure is not retried", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wechat-cover-other-"));
  try {
    const cache = new CoverMaterialCache(path.join(directory, "cache.json"));
    let draftAttempts = 0;
    const client = {
      async uploadPermanentImage() {
        return { mediaId: "COVER", url: null };
      },
      async addDraft() {
        draftAttempts += 1;
        throw new WechatApiError("ip not in whitelist", "wechat_api_rejected", { errcode: 40164 });
      },
    };
    const result = await pushBriefingToWechatDraft({
      article, config: enabled(), mode: "apply", env: ENV, coverCache: cache, clientFactory: () => client,
    });
    assert.equal(result.status, "failed");
    assert.equal(draftAttempts, 1, "an IP allowlist error must not trigger a re-upload");
    assert.equal(result.written, true, "a freshly uploaded cover is a real side effect");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the cache survives a round trip and forgets on request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wechat-cache-io-"));
  try {
    const cache = new CoverMaterialCache(path.join(directory, "cache.json"));
    assert.equal(await cache.lookup("missing"), null);
    await cache.remember("abc", "MEDIA-1");
    assert.equal(await new CoverMaterialCache(path.join(directory, "cache.json")).lookup("abc"), "MEDIA-1");
    assert.equal(await cache.forget("abc"), true);
    assert.equal(await cache.forget("abc"), false);
    assert.equal(await cache.lookup("abc"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hashing distinguishes different cover bytes", () => {
  assert.equal(hashCover(Buffer.from("a")), hashCover(Buffer.from("a")));
  assert.notEqual(hashCover(Buffer.from("a")), hashCover(Buffer.from("b")));
});
