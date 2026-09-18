# AI Growth Intelligence (`ai-growth-intelligence`)

A private OpenClaw Skill that verifies high-value public information and proactively sends one dense, practical Simplified Chinese briefing through the host `message` tool.

## Core capabilities

- Dynamic GitHub, AI, Skill, and general-intelligence sections.
- Each section independently requires at least five qualifying entries; underfilled sections are omitted without filler.
- First-party evidence for every retained item and two independent sources for material claims.
- Independent Skill discovery across ClawHub, SkillHub, skills.sh, SkillsMP, and GitHub Skill repositories, with cross-section deduplication.
- Scheduled 24-hour briefing at 08:00 and 12-hour update at 20:00 Asia/Shanghai. Only confirmed host-message delivery counts as success.

## Optional GitHub auto-fork and organization

The package includes `github自动fork并整理`, but it is disabled by default and never auto-registers a schedule. After explicit opt-in and risk acknowledgement, it can scan recent public repositories, preview reviewed Chinese annotations and English category topics, then create or reorganize Forks in a personal GitHub account.

Descriptions use:

```text
中文简介：concise Chinese annotation | English description: complete original English description
```

Existing topics and the original English description are preserved atomically; authoritative topics are read from GitHub and checked again before writing. A repository is skipped before writing if GitHub's limits cannot hold the complete result. Hard ceilings are 10 queries, 100 candidates, and 10 write slots per run. Live apply also requires an environment-injected `GITHUB_TOKEN`, a personal owner, persistent risk acknowledgement, and a per-run acknowledgement flag. Tokens are never accepted on the CLI or stored in files/results. Operation results distinguish confirmed, rejected, and unknown remote-write outcomes.

Read `references/github-auto-fork-and-organize.md` before enabling the capability. Use a short-lived fine-grained token limited to the personal account, `Administration: Read and write`, and `Contents: Read-only`; do not add unrelated permissions. Scheduled runs require confirmed host-message delivery or return `delivery_failed`.

## Scope and compatibility

- No website, dashboard, public publishing, or credential persistence. The optional WeChat draft box is disabled by default and, once enabled, can only leave a draft for a person to review; its cover is generated locally and publishing stays a manual step in the WeChat console.
- No repository cloning, code execution, commits, Issues/PRs, or deletion.
- The active identity is `ai-growth-intelligence` v0.11.0; the legacy local data directory remains `Documents/growth-intelligence`.
- This release uses `ai-growth-intelligence` v0.11.0. Historical SkillHub records under `growth-intelligence` remain separate and are not aliases for the active slug.
