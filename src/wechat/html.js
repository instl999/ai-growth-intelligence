/**
 * Convert the briefing Markdown into HTML that survives the WeChat editor.
 *
 * Two constraints shape this:
 *
 * 1. WeChat strips <style> blocks, class attributes and most selectors, so
 *    every rule has to be an inline style attribute.
 * 2. Links to domains outside the account's own whitelist are rendered but not
 *    tappable. A briefing whose value is its sources would silently lose them,
 *    so by default the URL is printed as visible text the reader can copy.
 *    Set linkStyle to "anchor" if the account has whitelisted its sources.
 */

import { LINE_MARKERS } from "../core/article-composer.js";

const STYLES = {
  body: "margin:0;padding:0 2px;font-size:16px;line-height:1.8;color:#2b2f36;word-break:break-word;",
  digest: "margin:0 0 26px;padding:14px 16px;background:#f4f6f8;border-left:3px solid #4a6fa5;border-radius:4px;font-size:15px;color:#43494f;",
  // Section headings read as banners, the way an Official Account separates
  // chapters, instead of as one more bold line in the column of text.
  h2: "margin:40px 0 20px;padding:9px 0;font-size:19px;font-weight:700;color:#12161a;text-align:center;letter-spacing:1px;border-top:1px solid #eceff2;border-bottom:1px solid #eceff2;",
  h3: "margin:32px 0 14px;font-size:17px;font-weight:700;color:#12161a;line-height:1.55;",
  p: "margin:0 0 14px;",
  li: "margin:0 0 10px;padding-left:12px;border-left:2px solid #e3e7ec;",
  label: "font-weight:600;color:#12161a;",
  url: "color:#6b7480;font-size:13px;word-break:break-all;",
  anchor: "color:#4a6fa5;text-decoration:none;",
  quote: "margin:26px 0 0;padding:12px 16px;background:#fff8e6;border-left:3px solid #e0a33e;font-size:14px;color:#6b5a32;",
  footer: "margin:30px 0 0;padding-top:14px;border-top:1px solid #eceff2;font-size:13px;color:#9aa2ab;",
  // Lines that are not body prose. Giving each its own block keeps a story
  // scannable: reference detail is boxed, sources recede.
  tool: "margin:0 0 14px;padding:10px 14px;background:#fafbfc;border:1px solid #eceff2;border-radius:4px;font-size:14px;color:#4a5159;",
  // 速览 entries sit tight together so the whole day reads as one block.
  index: "margin:0 0 9px;padding:0;font-size:15px;color:#3a4048;line-height:1.6;",
  source: "margin:0 0 4px;font-size:13px;color:#9aa2ab;",
  // The column name and date, small and grey under the title.
  byline: "margin:0 0 20px;font-size:13px;color:#9aa2ab;",
  divider: "margin:26px 0;border-top:1px solid #eceff2;",
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Undo the backslash escaping the Markdown composer applies. */
function unescapeMarkdown(value) {
  return String(value).replace(/\\([\\`*_[\]<>])/gu, "$1");
}

function isSafeHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function renderInline(text, { linkStyle }) {
  const source = String(text);
  let output = "";
  let index = 0;
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    output += escapeHtml(unescapeMarkdown(source.slice(index, match.index)));
    if (match[3] !== undefined) {
      output += `<span style="${STYLES.label}">${escapeHtml(unescapeMarkdown(match[3]))}</span>`;
    } else {
      const label = escapeHtml(unescapeMarkdown(match[1]));
      const url = match[2];
      if (!isSafeHttpUrl(url)) output += label;
      else if (linkStyle === "anchor") output += `<a href="${escapeHtml(url)}" style="${STYLES.anchor}">${label}</a>`;
      else output += `${label} <span style="${STYLES.url}">${escapeHtml(url)}</span>`;
    }
    index = match.index + match[0].length;
  }
  output += escapeHtml(unescapeMarkdown(source.slice(index)));
  return output;
}

/**
 * Pick a paragraph's style from the role marker in front of it.
 *
 * Unmarked paragraphs are body prose. The first one is special and differs by
 * layout: the article layout opens with a byline, the brief layout with a
 * summary card, so the caller says which it is rather than this guessing.
 */
function paragraphStyle(line, { firstParagraph, style }) {
  if (line.startsWith(LINE_MARKERS.tool)) return STYLES.tool;
  if (line.startsWith(LINE_MARKERS.source)) return STYLES.source;
  if (!firstParagraph) return STYLES.p;
  return style === "brief" ? STYLES.digest : STYLES.byline;
}

/**
 * @param {string} markdown  Briefing Markdown from composeArticle().
 * @param {object} [options]
 * @param {"text"|"anchor"} [options.linkStyle]  How to present source links.
 * @param {string} [options.footer]              Optional trailing note.
 * @param {string} [options.style]                The composer's article.style.
 * @returns {string} HTML for the WeChat draft `content` field.
 */
export function markdownToWechatHtml(markdown, { linkStyle = "text", footer = "", style = "article" } = {}) {
  if (typeof markdown !== "string" || !markdown.trim()) throw new TypeError("markdown must be a non-empty string.");
  const lines = markdown.split(/\r?\n/u);
  const parts = [];
  let listOpen = false;
  let firstHeadingSeen = false;

  const closeList = () => {
    if (listOpen) {
      parts.push("</section>");
      listOpen = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    // The article title is carried by WeChat's own title field; drop the H1.
    if (line.startsWith("# ")) {
      closeList();
      firstHeadingSeen = true;
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      parts.push(`<h2 style="${STYLES.h2}">${renderInline(line.slice(3), { linkStyle })}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      parts.push(`<h3 style="${STYLES.h3}">${renderInline(line.slice(4), { linkStyle })}</h3>`);
      continue;
    }
    if (line.startsWith("> ")) {
      closeList();
      parts.push(`<p style="${STYLES.quote}">${renderInline(line.slice(2), { linkStyle })}</p>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        parts.push('<section style="margin:0 0 16px;">');
        listOpen = true;
      }
      const content = line.slice(2);
      const itemStyle = content.startsWith("**") ? STYLES.li : STYLES.index;
      parts.push(`<p style="${itemStyle}">${renderInline(content, { linkStyle })}</p>`);
      continue;
    }
    // A thematic break renders as a styled empty section rather than <hr>,
    // which the WeChat editor drops.
    if (/^(-{3,}|\*{3,}|_{3,})$/u.test(line.trim())) {
      closeList();
      parts.push(`<section style="${STYLES.divider}"></section>`);
      continue;
    }
    closeList();
    parts.push(`<p style="${paragraphStyle(line, { firstParagraph: firstHeadingSeen && parts.length === 0, style })}">${renderInline(line, { linkStyle })}</p>`);
  }
  closeList();
  if (footer) parts.push(`<p style="${STYLES.footer}">${escapeHtml(footer)}</p>`);
  return `<section style="${STYLES.body}">${parts.join("")}</section>`;
}

/** WeChat rejects a digest longer than 120 characters. */
export function buildDigest(text, limit = 120) {
  const flat = String(text ?? "").replace(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** WeChat rejects a title longer than 64 characters. */
export function buildTitle(text, limit = 64) {
  const flat = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!flat) throw new TypeError("An article title is required.");
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
