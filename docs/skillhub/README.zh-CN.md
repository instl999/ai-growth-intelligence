# AI 成长情报（ai-growth-intelligence）

这是一个运行在 OpenClaw 上的个人情报 Skill：从公开中外来源中筛选经过验证的高价值信息，并通过宿主 `message` 工具直接发送一份高密度、可行动的简体中文综合情报。

## 核心能力

- 按需生成 `GitHub 精选`、`AI 情报`、`Skill 精选`、`综合情报`。
- 每个板块独立至少 5 条合格内容；不足时省略，不用低价值内容凑数。
- 每条保留一方/官方来源；重要主张需要两个独立来源。
- 独立扫描 ClawHub、SkillHub、skills.sh、SkillsMP 和 GitHub Skill 仓库，并跨板块去重。
- 08:00 发送最近 24 小时日报，20:00 发送最近 12 小时增量情报；只有 `message` 工具确认才算交付成功。
- 阅读版式参考公众号与头条：每条内容是一段可以一路滑到底的短文——一句钩子、一段正文、一件可以今天就做的事，来源放在最后，条与条之间用分隔线断开。此前每句话前面都有一个粗体标签（`为什么值得关注：`、`项目情况：`、`建议行动：`），十条内容要跨过四十个标签才能读到正文。
- 发送前可以先看排版：`node src/cli/index.js preview-article --config config.json --items items.json --markdown`；`--style brief` 是旧版式，写作规范见 `references/article-layout.md`。

## 可选：github自动fork并整理

安装包包含该功能，但默认关闭，也不会自动注册定时任务。只有用户明确启用并阅读风险说明后，才可扫描最近活跃的公开仓库、预览中文简介和英文分类标签，并在个人 GitHub 账号中创建/整理 Fork。

描述格式：

```text
中文简介：简明中文说明 | English description: 原仓库完整英文简介
```

已有 topics 和原英文简介必须完整保留；topics 会从 GitHub 权威接口读取并在写入前复核，超出限制时会在写入前跳过。硬上限为每次 10 条查询、100 个候选和 10 个写入 slot。live apply 还需要环境变量 `GITHUB_TOKEN`、个人 owner、配置中的风险确认和本次命令的确认标志。Token 不得放入聊天、配置文件或命令行。操作结果区分 `confirmed`、`rejected` 和可能已发生远端写入的 `unknown`。

创建 Token 前请阅读 `references/github-auto-fork-and-organize.md`。推荐使用 fine-grained Token，权限限制为个人账号、短有效期、`Administration: Read and write` 和 `Contents: Read-only`，不添加无关权限；用户指定的 classic Token 入口需要额外注意其权限范围更宽。定时运行必须由宿主确认消息交付，否则返回 `delivery_failed`。

## 隐私与边界

- 不创建网站或服务器，没有任何公众号发布能力。可选的「微信公众号草稿箱」默认关闭，明确启用后最多也只能留下一篇待人工审核的草稿，封面在本地生成；发布始终是公众号后台里的手动动作。
- 不克隆或执行 Fork 代码，不删除仓库。
- 名称更新为 `ai-growth-intelligence` 后，旧本地数据仍保存在 `Documents/growth-intelligence`。
- 本次发行使用 `ai-growth-intelligence` v0.11.0；历史 SkillHub `growth-intelligence` 记录继续独立保留，不作为当前 slug 的别名。
