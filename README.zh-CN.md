# AI 成长情报

<!-- repository-catalog:start -->
**分类：学习、研究与知识记录** · [同类仓库](https://github.com/instl999?tab=repositories&q=topic%3Aknowledge-tools)

OpenClaw Skill：从有出处的公开信息生成中文 AI、GitHub 与 Skill 情报简报。

相关项目：[elder-lifestory](https://github.com/instl999/elder-lifestory) · [exam-scribe](https://github.com/instl999/exam-scribe)

[English](README.md)
<!-- repository-catalog:end -->

[English](README.md) | 简体中文

`ai-growth-intelligence` 是 OpenClaw Skill，把有出处的公开信息整理成一篇可直接阅读的中文情报简报。

## 适合做什么

- 关注 AI 新闻、GitHub 项目和可安装的 Agent Skills。
- 从公开来源筛选值得阅读或尝试的内容，并保留事实出处。
- 输出文章式简报：速览索引、每条内容的完整段落和来源链接。

新闻栏目查看最近 24 小时；GitHub 与 Skill 栏目从最近 7 天的候选中筛选，优先考虑最近 24 小时有发布或重大更新的项目。每栏至少 5 条、最多 10 条；不足时省略该栏，不用低价值条目凑数。已推荐的内容在 30 天内去重。

## 环境与配置

运行在 OpenClaw 宿主中，需要宿主提供检索与消息送达能力。项目使用 Node.js CLI，没有第三方运行时依赖。配置字段见 [`config.example.json`](config.example.json)，Skill 的使用规则见 [`SKILL.md`](SKILL.md)。

下面的命令用于查看已经准备好的简报，不会发送消息：

```powershell
node src/cli/index.js preview-article --config config.json --items items.json --markdown
```

默认使用文章样式；追加 `--style brief` 可查看分段卡片式布局。结构与写作要求见 [`references/article-layout.md`](references/article-layout.md)，筛选时间窗见 [`references/section-windows.md`](references/section-windows.md)。

| 配置 | 含义 |
| --- | --- |
| `article.style` | `article` 或 `brief` |
| `sections.<key>.discoveryWindowHours` | 候选内容的时间范围 |
| `sections.<key>.highlightWindowHours` | 优先关注的近期活动时间范围 |
| `sections.<key>.minItems` / `maxItems` | 栏目条目数量范围 |
| `minimumValueScore` | 候选价值评分门槛 |
| `recommendationHistoryDays` | 已推荐内容的去重天数 |

来源校验不是可关闭的开关：缺少第一方来源的条目会被拒绝。其余部分配置是宿主 AI 应遵循的指令，不一定是 CLI 直接读取的运行时字段。

## 可选功能

**公众号草稿箱**和**GitHub 自动 fork 并整理**已包含在项目中，默认关闭；整理本仓库不等于启用这些功能。

- 公众号功能只创建待审草稿，不发布、不群发。参数与恢复方法见 [`references/wechat-draft-box.md`](references/wechat-draft-box.md)。
- GitHub 功能先预览中文简介与英文 topics，再对选定仓库 fork 并修改描述和标签；保留原英文简介与已有标签，不运行仓库代码。详见 [`references/github-auto-fork-and-organize.md`](references/github-auto-fork-and-organize.md)。
- 凭据由宿主环境提供，不写入配置文件、说明文档或日志。
- 简报的消息送达仍由 OpenClaw 宿主负责；保存文件或生成公众号草稿不能代替送达结果。

## 进一步阅读

[英文完整说明](README.md) 包含 CLI 命令、可选功能的应用条件、兼容路径及运行结果字段。本中文文档是用途与操作入口，不替代完整参数说明。
