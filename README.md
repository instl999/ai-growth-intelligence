# AI Growth Intelligence

`ai-growth-intelligence` is a private OpenClaw Skill that turns verified public information into one directly readable Simplified Chinese intelligence briefing.

## What it delivers

- One high-density Markdown briefing with dynamic `GitHub 精选`, `AI 情报`, `Skill 精选`, and `综合情报` sections.
- Per-section discovery windows. `AI 情报` and `综合情报` are news and use the last 24 hours. `GitHub 精选` and `Skill 精选` draw from a 7-day pool and rank first whatever shipped a release or major update in the last 24 hours, because a project is often only worth recommending days after it appears.
- Each section independently requires at least five qualifying entries and shows at most ten. Underfilled sections are omitted and never padded with low-value filler; the wider pool exists so that padding is never the way to reach five.
- Entries already recommended are suppressed for 30 days, so a seven-day pool does not repeat the same repository every day. See [references/section-windows.md](references/section-windows.md).
- Evidence-led discovery from Chinese and international public sources. Every retained item needs a first-party source; material claims need two independent sources.
- Independent Skill discovery through ClawHub, SkillHub, skills.sh, SkillsMP, and GitHub repositories containing installable Skills, with cross-section deduplication.
- Mandatory proactive delivery through the host OpenClaw `message` tool. A normal assistant response or saved file is not successful delivery.

## How it reads

The briefing is written as an article, the way a Chinese daily tech roundup is: the title is the day's leading headlines, a 速览 index lists every entry so the whole day reads at a glance, and each entry is then written out as a short story in 2-5 paragraphs with its sources attributed inside the sentences.

The structural part is that entries carry a `body` array of finished paragraphs. Earlier layouts assembled every entry from three fixed fragment fields, so however the styling changed, the output could only ever be a card: a hook, one merged paragraph, a labelled action block. Letting the writer decide where paragraphs break is what turns a record into something you read. When `body` is absent the layout still falls back to three segmented paragraphs built from those fields.

Look at a briefing before sending it:

```powershell
node src/cli/index.js preview-article --config config.json --items items.json --markdown
```

`--style brief` renders the original labelled layout for comparison, and `{ "article": { "style": "brief" } }` in `config.json` makes that the default again. The full structure and per-field writing rules are in [references/article-layout.md](references/article-layout.md).

## Configuration

These keys change runtime behaviour and are enforced in code:

| Key | Effect |
| --- | --- |
| `article.style` | `article` (default) or `brief`. An unrecognised value falls back to `article`. |
| `sections.<key>.discoveryWindowHours` | How far back that section draws candidates. |
| `sections.<key>.highlightWindowHours` | What counts as recently active inside a pooled section. |
| `sections.<key>.minItems` / `maxItems` | The section's floor and cap. A section below its floor is omitted. |
| `minimumValueScore` | Value-score floor, 0-100. Scoring is efficiency 30 + income 30 + trend 30 + novelty 10. |
| `recommendationHistoryDays` | Suppression window for entries already delivered, clamped to 1-365. |
| `wechatDraftBox.*` | The optional draft-box feature; see below. |
| `githubAutoForkAndOrganize.*` | The optional Fork feature; see below. |

The remaining keys in `config.example.json` are instructions the host AI follows rather than switches the runtime reads. Source validation in particular is unconditional: an item with no first-party source is rejected whatever the configuration says.

## Optional `微信公众号草稿箱`

Turns a finished briefing into a WeChat Official Account **draft**, with a cover image generated locally.

It is installed but disabled by default:

```json
{ "enabled": false, "dryRun": true, "linkStyle": "text" }
```

The widest outcome it can produce is a draft awaiting review. `WechatDraftClient` has no publish, mass-send, schedule, or delete method, so publishing stays a manual step in the WeChat console. Credentials come only from `WECHAT_APP_ID` and `WECHAT_APP_SECRET` in the environment; a config file containing a credential-shaped key is rejected.

```powershell
node src/cli/index.js wechat-contract --config config.json
node src/cli/index.js wechat-draft --config config.json --items items.json --mode dry_run --cover-out preview.png
node src/cli/index.js wechat-draft --config config.json --items items.json --mode apply --acknowledge-write
```

A live write needs `enabled: true`, `dryRun: false`, and the per-run `--acknowledge-write` flag together. Items are routed through the same assessment and section-minimum pipeline as the briefing itself.

It runs after briefing delivery and never replaces it. `node src/cli/index.js delivery-plan --config config.json --items items.json` prints the ordered steps; `completionRequires` lists message delivery alone, so a draft can never complete a run.

An identical cover already uploaded for a briefing is reused instead of uploaded again, so a retry after a failed draft does not spend another permanent-material slot. If that material was deleted in the console, WeChat rejects the media_id and the cover is re-uploaded once, transparently.

The cover is 900x383, deterministic per briefing, drawn from six curated palettes with no external image service and no extra API key. See [references/wechat-draft-box.md](references/wechat-draft-box.md).

## Optional `github自动fork并整理`

The optional feature can scan recent high-signal public repositories, preview reviewed Chinese annotations and English topics, then Fork and organize selected projects in the user's personal account.

It is installed but disabled by default:

```json
{
  "enabled": false,
  "riskAcknowledged": false,
  "dryRun": true,
  "schedule": { "enabled": false, "apply": false }
}
```

It never clones or runs repository code. Live mode creates external Forks and updates only their description and topics. The description format is:

```text
中文简介：简明中文说明 | English description: original repository English description
```

The original English description and all existing topics are preserved atomically. Topics are read from GitHub before preview and re-read from the target Fork immediately before a live write. If GitHub's description/topic limits cannot hold the complete result, that repository is skipped before writing.

Hard ceilings are 10 search queries, 100 selected candidates, and 10 Fork/write slots in one run. Configuration may lower but cannot raise them. A slot is consumed when a repository enters the write stage, including partial or failed attempts.

### Safe preview/apply use

Inspect the read-only contract:

```powershell
npm run github:contract
```

After the user explicitly enables the feature, scan candidates and exclusion reasons:

```powershell
npm run github:scan -- --config config.json
```

Prepare an annotation file keyed by lowercase repository name:

```json
{
  "owner/repository": {
    "chineseSummary": "简明、可核验的中文简介",
    "englishTags": ["ai-agents", "developer-tools"]
  }
}
```

Preview first:

```powershell
npm run github:run -- --config config.json --annotations annotations.json --mode dry_run
```

Live apply additionally requires `config.riskAcknowledged=true`, an environment-injected `GITHUB_TOKEN`, a personal account owner, and a per-run acknowledgement flag:

```powershell
npm run github:run -- --config config.json --annotations annotations.json --mode apply --acknowledge-risk
```

The CLI has no Token option. It rejects credential fields and credential-shaped strings in configuration/annotation documents. Never put a Token in chat, JSON, `.env`, logs, URLs, or source files.

Operation records use `started`, `confirmed`, `rejected`, or `unknown`; an `unknown` write may have occurred remotely and must be checked on GitHub before retrying. Top-level `writeAttempted`, `writePerformed`, `writeMayHaveOccurred`, and `writeOutcome` fields make partial outcomes explicit.

Before any live run, read [the risk, Token, and recovery guide](references/github-auto-fork-and-organize.md). It explains the user-requested [classic Token entry](https://github.com/settings/tokens/new), the recommended [fine-grained Token entry](https://github.com/settings/personal-access-tokens/new), and least-privilege settings.

## OpenClaw operation

Configure briefing jobs at 08:00 and 20:00 Asia/Shanghai using the installed OpenClaw scheduler schema. Give both jobs a permitted destination and access to the host `message` tool.

The optional GitHub automation schedule is separate and must never be registered or enabled without explicit user authorization. An enabled run also needs a host-injected `deliverResult` callback and a confirmed message receipt; otherwise its outcome is `delivery_failed`.

## Scope and compatibility

- Active package/Skill identity: `ai-growth-intelligence` v0.11.0.
- Historical SkillHub publication records remain under their historical `growth-intelligence` slug.
- Existing local data remains under `Documents/growth-intelligence` for backward compatibility.
- GitHub Tokens are read only from the host environment and are never persisted.
- This package does not create a web service and has no external publishing or credential-storage capability.
