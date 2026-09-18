# 微信公众号草稿箱（可选功能）

把已经生成好的情报简报，连同一张自动生成的封面图，写入微信公众号的**草稿箱**。

这个功能默认关闭。启用之后默认仍然只做预览。它能产生的最大后果，是在公众号后台留下一篇等待人工审阅的草稿。

## 它做什么，不做什么

只调用三个接口：

| 接口 | 用途 |
| --- | --- |
| `cgi-bin/token` | 换取 access_token |
| `cgi-bin/material/add_material?type=image` | 上传封面图，拿到 `thumb_media_id` |
| `cgi-bin/draft/add` | 新建一篇草稿 |

代码里**不存在**发布、群发、定时群发、删除素材或修改账号设置的方法。这不是一个可以被配置项打开的开关，而是客户端上根本没有这些方法：`src/wechat/api-client.js` 里的 `WechatDraftClient` 只有上面三个动作。发布这一步必须由人打开后台手动完成。

## 凭据

`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET` 只从运行环境读取。

- 配置文件里出现 `secret`、`token`、`password`、`credential` 之类的键名会被直接拒绝，报 `credentials_in_config`。
- 不要让用户把 AppSecret 贴进对话。
- 错误信息、日志和返回值中的密钥与 access_token 会被替换成 `[redacted]`。
- 自检脚本会扫描整个包，`WECHAT_APP_SECRET=<32位十六进制>` 这种形态会被判定为泄露。

微信要求调用方 IP 在公众号后台的白名单里。不在白名单时微信返回 errcode 40164，功能会把这个错误原样报出来，不做任何绕过。

## 配置

```json
{
  "wechatDraftBox": {
    "enabled": false,
    "dryRun": true,
    "author": "",
    "sourceUrl": "",
    "linkStyle": "text",
    "openComment": false,
    "onlyFansCanComment": false,
    "coverWordmark": "AI GROWTH INTELLIGENCE",
    "footer": ""
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `enabled` | 总开关，默认 `false`。为 `false` 时不构造客户端，不发任何请求。 |
| `dryRun` | 默认 `true`。为 `true` 时即使显式 `--mode apply` 也会被拦下，返回 `dry_run_locked_in_config`。 |
| `author` | 署名，最多 8 个字符（微信限制）。 |
| `sourceUrl` | 「阅读原文」链接，必须是 http(s)。 |
| `linkStyle` | `text`（默认）把来源网址作为可见文字排在标题后；`anchor` 输出真正的 `<a>` 标签。 |
| `openComment` / `onlyFansCanComment` | 评论设置，默认都关闭。 |
| `coverWordmark` | 封面上的拉丁文字，最多 48 字符。 |
| `footer` | 正文末尾的一行说明，最多 200 字符。 |

### 关于 `linkStyle`

微信正文里指向非白名单域名的链接**点不动**。情报简报的价值大半在来源，所以默认把网址当作可见文字排出来，读者可以复制。只有当公众号已经在后台把来源域名加进白名单时，才值得改成 `anchor`。

## 使用

先看功能边界，这个命令只读，不需要凭据：

```powershell
node src/cli/index.js wechat-contract --config config.json
```

预览。渲染标题、摘要、正文 HTML 和封面图，并把封面写到本地，但完全不联网：

```powershell
node src/cli/index.js wechat-draft --config config.json --items items.json --mode dry_run --cover-out preview.png
```

先让用户看过预览和封面，确认之后再写入草稿箱。实际写入需要三个条件同时满足：`enabled: true`、`dryRun: false`、以及本次运行显式带上 `--acknowledge-write`：

```powershell
node src/cli/index.js wechat-draft --config config.json --items items.json --mode apply --acknowledge-write
```

`--items` 会走和简报本身完全相同的评估、去重和板块下限流程，因此草稿里不可能出现简报本身会拒绝的内容。也可以用 `--article` 直接传一份已经生成好的 `{ title, digest, markdown }`。

## 与简报投递的关系

这个功能永远排在简报投递之后，并且**不能代替**投递。没有人手动发布的草稿等于没送到任何人手里。

```powershell
node src/cli/index.js delivery-plan --config config.json --items items.json --message-tool
```

返回的 `completionRequires` 里只有 `message_delivery`。`wechat_draft` 步骤标了 `required: false` 和 `runsAfter: message_delivery`，即使它被启用，也不会让 `completionRequires` 多出一项。

## 封面复用

封面按字节做 sha256，命中过的 media_id 记在本地 `wechat-cover-material.json` 里（数据目录下，最多 200 条）。

- 同一篇简报重跑不会再传一次封面，返回值里 `coverReused: true`。这很重要：永久素材占用公众号配额，而「封面传成功、草稿建失败」的重试最容易悄悄堆积孤儿素材。
- 如果后台把那张素材删了，微信会用 40007 / 40118 / 41005 拒绝这个 media_id。这时缓存条目会被丢弃、重新上传一次、再建一次草稿，整个过程对调用方是透明的。
- 其它错误（比如 IP 不在白名单的 40164）不会触发重传。

## 返回值

| `status` | 含义 |
| --- | --- |
| `disabled` | 功能没开，什么都没做 |
| `dry_run` | 已渲染，未联网，`coverPath` 是本地封面路径 |
| `blocked` | 被拦下，`reason` 说明原因（`dry_run_locked_in_config`、`missing_credentials`、`write_acknowledgement_required`） |
| `created` | 草稿已建立，`draftMediaId` 是草稿 id |
| `failed` | 失败；`written` 表示这次运行是否新建了永久素材（复用旧封面时为 `false`） |

`failed` 且 `written: true` 意味着这次运行新传了一张封面进永久素材库，但草稿没建成。重跑会复用这张封面而不是再传一张，所以不会继续堆积孤儿素材。

## 封面图

封面在本地生成，不调用任何图片服务，也不需要额外的 API key：

- 900×383，微信推荐的大图比例。
- 同一篇简报永远得到同一张封面；不同简报的封面明显不同。种子来自日期和标题。
- 配色从 6 套预先调好的方案里按种子选取，不是随机生成色相——随机色相的观感通常很差。
- 版面：渐变底 + 柔光 + 斜向色块 + 一排由种子决定高度的数据条 + 拉丁字标和日期。
- 板块标签（GITHUB / AI / SKILL / GROWTH）从简报实际包含的板块推导。

封面只排拉丁字和数字。渲染中文需要内嵌字体文件，体积会超过整个 Skill，因此中文标题留在文章里。想换字标就改 `coverWordmark`。

## 限制

微信的硬限制，超出会在本地就报错，而不是等接口拒绝：

- 标题 64 字符，超出截断。
- 摘要 120 字符，超出截断。
- 正文 20000 字符。**超出会直接报 `content_too_long` 并中止**，不做截断——悄悄截短一篇情报简报会丢掉条目和来源，比不建草稿更糟。报错信息里会给出超出多少，以及把 `linkStyle` 改成 `anchor` 可以省下多少字符。

一次运行只建立一篇草稿。
