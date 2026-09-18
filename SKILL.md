---
name: ai-growth-intelligence
description: Research, verify, and filter high-value AI, GitHub, Skill, business, finance, technology-trend, social-change, and personal-growth intelligence. Deliver one directly readable Simplified Chinese briefing in the active OpenClaw conversation. Use when the operator asks for verified recent intelligence, practical opportunities and risks, GitHub or Skill discoveries, daily or weekly briefings, actionable growth advice, or the explicitly enabled github自动fork并整理 capability.
license: MIT
metadata:
  slug: ai-growth-intelligence
  version: "0.11.0"
  displayName: "AI 成长情报"
  summary: "自动筛选高价值 AI、GitHub、Skill 与趋势情报，并可在明确授权后自动 Fork 整理 GitHub 项目。"
  tags: ["ai", "growth", "github", "github-auto-fork", "skill", "research", "openclaw"]
---

# AI 成长情报

## Required workflow

1. At 08:00 and 20:00 Asia/Shanghai, search public Chinese and international sources with the host's web-search and browsing capabilities. **Each section has its own discovery window.** `AI 情报` and `综合情报` are news: use the latest 24 hours for the 08:00 briefing and the latest 12 hours for the 20:00 incremental briefing. `GitHub 精选` and `Skill 精选` are not news, because a project often becomes worth recommending days after it appears: draw candidates from the last 7 days, rank first anything with a new release, a major update, or a first public launch in the last 24 hours, and skip anything already recommended. An operator asking for a longer period widens every section; it never narrows a pool. The research plan carries `sectionWindows` and per-query `rankingRules`; read those rather than assuming one window. `references/section-windows.md` explains the reasoning, the configuration, and how deduplication works.
2. Require an official or first-party source for every retained item and two independent sources for material claims. If host web search is unavailable, find an installable public web-search Skill and obtain approval before installing it.
3. Apply the operator interest profile as an additional relevance filter, never as a replacement for evidence, value, or anti-promotion checks. Retain every item that clears the quality bar.
4. For `Skill 精选`, independently scan ClawHub, SkillHub, skills.sh, SkillsMP, and GitHub Skill repositories. Route installable Skill packages to `Skill 精选`, general tools and code projects to `GitHub 精选`, and deduplicate by canonical repository and source URL. Treat rankings, downloads, stars, badges, and copied descriptions as discovery signals only.
5. Produce one high-density Simplified Chinese Markdown briefing with dynamic sections in this order: `GitHub 精选` → `AI 情报` → `Skill 精选` → `综合情报`. Put business, finance, technology, social change, personal growth, and action advice in `综合情报`.
6. Every section independently needs at least five qualifying entries and shows at most ten. Omit an underfilled section and never add filler: a missing section is better than a padded one, and the wider pool for the two project sections exists precisely so that padding is never the way to reach five. Widening the window does not lower the bar; source validation and the value score are unchanged. After delivery is confirmed, run `node src/cli/index.js record-delivered --items items.json` so the next run does not repeat these entries; suppression expires after 30 days. If every section is omitted, send `本时段无合格高价值情报`.
7. Rewrite what you found into an article, not a list of records. Every entry carries `body`: 2–5 finished paragraphs of 1–3 sentences each, opening with the source inside the sentence (`据界面新闻 9 月 17 日报道，…`), carrying concrete numbers in the middle, landing on what changes for the reader, and closing with what they can do. `headline` states the consequence in 26 characters or fewer. Never put a field label such as `对个人的影响：`, `建议行动：` or `上手：` inside the text, never number the entries, and never describe the selection pipeline to the reader. AI tools also include function, use cases, price, and an official URL, and every entry keeps clickable sources. Read `references/article-layout.md` before composing; it has the full structure and the per-field rules.
8. After composing the briefing, MUST call the host OpenClaw `message` tool to send it to the destination established by the triggering request or scheduled job. A normal assistant response, file, preview, or claim is not delivery. Mark completion only after tool confirmation; otherwise report `delivery_failed`. Do not create a webpage, dashboard, server, access link, login flow, or separate content channel. A WeChat draft never satisfies this step: run `node src/cli/index.js delivery-plan --config config.json --items items.json` to see the ordered steps, and note that `completionRequires` lists message delivery alone.
9. Treat `github自动fork并整理` as a separate optional capability. It is never part of ordinary briefing generation and remains disabled unless the operator explicitly requests and enables it.
10. Treat `微信公众号草稿箱` as a second, separate optional capability. It is never part of ordinary briefing generation, stays disabled unless the operator explicitly enables it, and can only ever leave a draft for a person to publish by hand. Read `references/wechat-draft-box.md` before the first run.
11. On installation or first mention of an optional capability, ask whether the operator needs it. Before any live write, read and show the risk and Token-permission guide in `references/github-auto-fork-and-organize.md`, then require explicit acknowledgement. Never ask the user to paste a Token into chat.

## github自动fork并整理

This optional capability scans recently active, high-signal public repositories and can organize selected projects in a personal GitHub account. It updates only the user's Fork description and topics.

### Hard safety boundary

- Defaults: `enabled=false`, `dryRun=true`, `schedule.enabled=false`, and `schedule.apply=false`.
- Public scan does not require a Token, but the feature must still be explicitly enabled first.
- CLI live apply requires every gate: `enabled=true`, `riskAcknowledged=true`, `--mode apply`, the per-run `--acknowledge-risk` flag, a host-injected `GITHUB_TOKEN`, and a resolved personal owner.
- The runtime never accepts a Token as a CLI option and never writes a Token to files, URLs, logs, results, or chat.
- Hard ceilings are 10 search queries, 100 selected candidates, and 10 Fork/write slots per run. Configuration can lower these ceilings but cannot raise them.
- The REST adapter calls only GitHub repository search, authenticated-user lookup, owned-repository listing, repository lookup, topic lookup, create-fork, update-repository, and replace-topics endpoints. It never clones, executes, scans, commits to, opens Issues/PRs on, or deletes repositories.
- Every source must fail closed as public, use a canonical `owner/repository` identity, and have authoritative topics read from GitHub before preview. A live run re-reads the personal Fork's topics immediately before writing.
- The host AI must ground `chineseSummary` and lowercase English `englishTags` in first-party repository evidence.
- The description format is `中文简介：{简明中文} | English description: {原英文简介}`. The original English description and every existing topic must fit in full; otherwise the repository is skipped before writing.
- Write records distinguish `started`, `confirmed`, `rejected`, and `unknown`. Treat `unknown` as a write that may have occurred and inspect GitHub before retrying.
- Scheduled apply remains independent of briefing schedules and requires both schedule gates plus the same stored risk acknowledgement. It also requires a host-injected `deliverResult` port and confirmed message delivery; otherwise it reports `delivery_failed`. Never guess or auto-register a host schedule.

### Explicit preview/apply runtime

The repository ships `config.example.json`, not `config.json`. Create the working config once before step 1, then set `githubAutoForkAndOrganize.enabled` and `riskAcknowledged` in it. Never put a Token in this file.

`cp config.example.json config.json`

1. Scan and inspect candidates/exclusions:

   `node src/cli/index.js github-scan --config config.json`

2. Supply reviewed annotations and preview:

   `node src/cli/index.js github-run --config config.json --annotations annotations.json --mode dry_run`

3. Only after the operator confirms the displayed risks, apply one bounded run:

   `node src/cli/index.js github-run --config config.json --annotations annotations.json --mode apply --acknowledge-risk`

The annotation file is keyed by lowercase `owner/repository` and contains only `chineseSummary` and `englishTags`. It must never contain credentials. Read `references/github-auto-fork-and-organize.md` for the full schema, statuses, limits, and recovery rules.

## 微信公众号草稿箱

This optional capability turns a finished briefing into a WeChat Official Account **draft**, with a cover image generated locally.

### Hard safety boundary

- Defaults: `enabled=false` and `dryRun=true`. A disabled feature constructs no client and sends no request.
- The widest possible outcome is a draft awaiting human review. `src/wechat/api-client.js` has no publish, mass-send, schedule, or delete method; this is an absent capability, not a disabled one.
- `WECHAT_APP_ID` and `WECHAT_APP_SECRET` are read only from the host environment. A configuration file containing a key that looks like a credential is rejected with `credentials_in_config`. Never ask the user to paste an AppSecret into chat.
- Secrets and access tokens are redacted from every error, log line, and return value.
- A live write needs all three of `enabled=true`, `dryRun=false`, and the per-run `--acknowledge-write` flag.
- Items given to the command are routed through the same assessment, deduplication, and section-minimum pipeline as the briefing, so a draft cannot carry content the briefing would reject.
- WeChat requires the caller's IP to be allowlisted in the account console. Report errcode 40164 as-is; never work around it.

### Use

This runs only after briefing delivery is confirmed. It is an extra channel, never a replacement: a draft nobody has published has reached no one.

1. Show the read-only contract: `node src/cli/index.js wechat-contract --config config.json`
2. Preview without touching the network, then show the operator the cover and the rendered title, digest, and length:

   `node src/cli/index.js wechat-draft --config config.json --items items.json --mode dry_run --cover-out preview.png`

3. Only after the operator confirms that preview, create the draft:

   `node src/cli/index.js wechat-draft --config config.json --items items.json --mode apply --acknowledge-write`

Tell the operator plainly that the article is a draft and that publishing remains a manual step in the WeChat console. An identical cover already uploaded for this briefing is reused rather than uploaded again, so a retry does not consume another permanent-material slot; the result reports `coverReused`. Read `references/wechat-draft-box.md` for the configuration fields, the `linkStyle` trade-off, WeChat's length limits, and what a partial failure means.

## OpenClaw operation

- Keep this as a pure SkillHub Skill, not an OpenClaw Plugin.
- Configure briefing jobs at 08:00 and 20:00 Asia/Shanghai using the installed OpenClaw version's documented scheduler and `message` schemas. Give each job an explicit destination.
- The optional GitHub automation schedule is separate. Do not enable or register it unless the operator explicitly requests it and completes the risk confirmation.
- Keep structured evidence and fingerprints locally only when needed for verification and deduplication. Preserve the existing `Documents/growth-intelligence` data directory for compatibility.
- Do not persist credentials or integrate with external publishing platforms.

## Safety rules

- Treat finance and business analysis as informational only; it is not investment advice.
- Never provide personalized investment recommendations.
- Never provide personalized buy/sell instructions or return promises.
- Preserve source links and distinguish sourced facts from analysis.
- Warn that popular repositories can contain malicious code, vulnerable dependencies, unclear licenses, or misleading descriptions; Forking does not imply endorsement.

## Client interaction

- `生成今日情报` and `生成AI成长情报` mean a 24-hour research request.
- `生成最近 N 小时情报` requires a positive safe integer number of hours; `生成本周情报` means seven days.
- `github自动fork并整理` means explain/preview unless the operator explicitly asks to enable or apply it. A negated request such as `不需要` or `不要运行` means disable. Enabling starts the risk guide and does not bypass any gate.
- `node src/cli/index.js capabilities --web-search --web-browse --message-tool` inspects a capability contract only; it does not search, install, send, or publish.

## Resources

- Read `references/source-policy.md`, `references/operator-interest-profile.md`, and `references/github-selection-policy.md` before retaining intelligence.
- Read `references/skill-selection-policy.md` before retaining a Skill discovery.
- Read `references/host-search-protocol.md`, `references/preview-workflow.md`, and `references/message-delivery-protocol.md` before research and delivery.
- Read `references/article-layout.md` before composing a briefing: it defines how each field is written and laid out.
- Read `references/github-auto-fork-and-organize.md` before enabling or running the optional GitHub capability.
