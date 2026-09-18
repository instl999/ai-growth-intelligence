# github自动fork并整理：风险、Token 与运行契约

## 默认状态与启用条件

本功能安装后默认关闭：

- `enabled: false`
- `riskAcknowledged: false`
- `dryRun: true`
- `schedule.enabled: false`
- `schedule.apply: false`

普通情报扫描、08:00/20:00 情报任务和安装过程都不会自动打开它。只有用户明确说需要后，宿主才可进入启用引导。首次 live apply 前必须再次完整说明风险并取得明确确认。

## live apply 前必须告知的风险

在调用任何 Fork、description 更新或 topics 更新 API 前，必须告诉用户：

1. 这不是只读搜索。它会在个人 GitHub 账号创建外部 Fork，并修改这些 Fork 的描述和 topics；后续步骤失败时，已经创建或修改的内容不会自动回滚或删除。
2. Fork 会增加仓库数量、存储、通知和维护负担。GitHub API 有搜索与写入限流；超时后的写入结果可能不确定，不能盲目重试。
3. 热门不代表安全、可靠、合规或适用。仓库可能含恶意代码、脆弱依赖、危险构建脚本、误导说明或不清晰许可证。本功能不克隆、不运行、不扫描、不修改代码，也不替用户作安全或法律判断。
4. 创建 Fork 和修改元数据需要高权限 Token。Token 泄露可能影响用户拥有的仓库，应使用短有效期、最小权限并由宿主 Secret 管理。
5. 中文简介由宿主 AI 依据仓库一方资料生成，不是原作者声明。原英文简介必须完整跟在中文简介后；无法完整容纳时会在写入前跳过，不会截断或改写原文。
6. topics 更新会替换完整 topics 列表。实现必须读取 GitHub 返回的权威 topics 并完整保留，再合并新英文标签；数量或长度超限时整仓跳过。
7. 定时 apply 可在用户不在线时持续创建/修改 Fork。只有用户单独确认定时写入并显式打开两个 schedule gate 后才能启用；建议先连续 dry-run，并把单次上限降到实际需要。

建议让用户明确确认：

> 我已阅读风险，知道该功能会使用 GitHub Token 在我的个人账号中创建和修改 Fork；我同意按当前单次上限执行，并理解已完成写入不会因后续失败自动回滚。

未获得确认时返回 `risk_acknowledgement_required`，不得创建客户端或发送写请求。

## Token 创建与最小权限

用户指定的 [GitHub New personal access token](https://github.com/settings/tokens/new) 是 classic Token 入口。优先使用权限更细的 [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)，并设置 30–90 天或更短的有效期。

### 推荐：fine-grained Token

1. `Resource owner` 选择个人 GitHub 账号。本版本不支持组织 owner。
2. 若需要整理任务刚创建的新 Fork，`Repository access` 通常需选择 `All repositories`；若只整理预先存在的明确仓库，可选择 `Only select repositories`，但新 Fork 可能不在授权范围。
3. `Repository permissions` 只开启：
   - `Administration: Read and write`：创建 Fork、更新 description 和 topics 所需。
   - `Contents: Read-only`：创建 Fork 时读取公开源仓库内容所需。
4. 不开启 Issues、Actions、Workflows、Secrets、Members、Packages、Delete 等无关权限，不使用组织 owner。

### 兼容入口：classic Token

如果必须使用用户指定的 classic Token 页面，本功能仅处理公开仓库，应只勾选 `public_repo`，不要勾选更宽的 `repo`。但 `public_repo` 仍对账号可访问的全部公开仓库授予广泛读写能力，安全边界明显大于 fine-grained Token，因此只应短期使用并在不再需要时立即删除。

### 保存和注入

Token 创建后只显示一次。不要粘贴到聊天、README、JSON、`.env`、Git 历史、命令行参数或日志。由 OpenClaw/宿主 Secret 注入环境变量 `GITHUB_TOKEN`。本功能没有 `--token` 参数，也会拒绝配置/注释中的凭据字段和疑似 Token 内容。

官方依据：

- [Create a fork](https://docs.github.com/en/rest/repos/forks)：fine-grained token 需要 `Administration: write` 与 `Contents: read`。
- [Update a repository / Replace all repository topics](https://docs.github.com/en/rest/repos/repos)：description 与 topics 更新需要 `Administration: write`。
- [Classifying a repository with topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)：topic 使用小写字母、数字和连字符；每个最多 50 个字符，每仓库最多 20 个。
- [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)：使用最小仓库范围、最小权限和过期时间；classic Token 的权限范围更宽。
- [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)：classic `public_repo` 对公开仓库提供广泛读写访问。

若 Token pending、被组织策略阻止或接口返回 403，不要扩大权限绕过限制。

## 固定安全上限

运行时有不可由配置提高的硬上限：

- 搜索查询最多 10 条；
- 每次选择候选最多 100 个；
- 每次进入 Fork/写入阶段的仓库最多 10 个；
- 配置中的 `maxQueries`、`maxCandidates`、`maxForksPerRun` 只能降低这些上限。

一个仓库进入写入阶段时立即消耗一个 slot，即使 Fork、description 或 topics 后续失败，防止部分失败绕过总量限制。

## 显式预览/执行协议

配置可使用 `config.example.json` 的 `githubAutoForkAndOrganize` 节。配置文件不得含 Token。

### 1. 扫描

```powershell
npm run github:scan -- --config config.json
```

扫描仅执行公开 GET 请求，返回候选、热度信号、查询统计和排除原因。搜索查询强制 `is:public`；响应项还要通过公开可见性、规范 `owner/repository`、更新时间、排除规则等 fail-closed 校验。公开扫描不要求 Token；即便如此，`enabled` 仍必须由用户明确设为 `true`，否则在创建客户端前返回 `disabled`。

### 2. 人工/宿主生成并复核注释

注释文件格式：

```json
{
  "owner/repository": {
    "chineseSummary": "基于仓库一方资料的简明中文简介",
    "englishTags": ["ai-agents", "developer-tools"]
  }
}
```

- key 必须已经是小写 `owner/repository`，不能依赖运行时静默改写。
- 只允许 `chineseSummary` 和 `englishTags` 两个字段；任何凭据字段或疑似 Token 内容都会被拒绝。
- `chineseSummary` 必须包含中文字符。
- `englishTags` 只允许英文字母、数字和连字符；空格/下划线会规范化为小写连字符。
- 每个 tag 最多 50 个字符，合并后 topics 最多 20 个。
- 合并描述最多 350 个 Unicode 字符。任何限制无法同时容纳“中文简介 + 完整英文原简介 + 全部已有 topics + 新标签”时，预检失败并跳过该仓库。

### 3. dry-run

```powershell
npm run github:run -- --config config.json --annotations annotations.json --mode dry_run
```

dry-run 不执行 POST/PATCH/PUT。它从 GitHub topics 端点读取源仓库的权威 topics，而不是信任搜索结果中的可能陈旧字段。若环境已有 Token，会尽力识别个人 owner 和已有 Fork；鉴权失败只作为脱敏 warning，仍可完成公开预览。

### 4. apply

```powershell
npm run github:run -- --config config.json --annotations annotations.json --mode apply --acknowledge-risk
```

apply 必须同时满足：

- `enabled=true`
- `riskAcknowledged=true`
- 显式 `--mode apply`
- 本次命令包含 `--acknowledge-risk`
- `GITHUB_TOKEN` 由环境注入
- 鉴权返回个人 `User` owner
- 目标 Fork owner 与该个人 owner 一致
- 客户端具备搜索、用户/仓库读取、topics 读取、Fork 等待和三种写入能力

运行时会完整列出个人 owner 的仓库以识别已有同源 Fork；分页触及安全上限时 fail closed，不在不完整清单上继续创建。新 Fork 可见后，还会读取目标 Fork 的权威 topics，再更新 description 和 topics。

## 写入审计、结果与恢复

- 每个变更调用发出前记录 `started`；收到成功响应后记录 `confirmed`。
- 明确的 4xx 拒绝记录为 `rejected`；超时、网络中断或无法确定远端状态的异常记录为 `unknown`。
- `writeAttempted` 表示至少开始过一次写调用；`writePerformed` 只表示至少一个写入被确认；`writeMayHaveOccurred` 对 `confirmed` 或 `unknown` 为真。
- `writeOutcome` 为 `none`、`confirmed`、`partial` 或 `unknown`。不能把“Fork 已成功、topics 失败”报告成零写入。
- 已有同源 Fork 不重复创建，但允许重新整理 description/topics，并计入写入上限；缺少 parent/source 的列表项会先通过仓库详情补全。
- 自己账号拥有的源仓库跳过，避免自 Fork。
- 对 `unknown` 操作，先在 GitHub 检查真实状态，再决定是否重试；不要盲目重跑整个批次。
- `rejected` 表示 GitHub 明确拒绝该调用，本次调用不应被描述为“可能成功”；但之前已确认的步骤仍不会回滚。
- 错误、日志、JSON 结果和消息中不得出现 Token。异步 logger 自身失败只产生 warning，不得覆盖真实操作结果。

## 定时配置与交付

```json
{
  "enabled": false,
  "riskAcknowledged": false,
  "schedule": { "enabled": false, "apply": false }
}
```

定时整理独立于普通情报任务。只有用户明确确认风险、Token 已由宿主 Secret 注入，并明确打开 `enabled`、`riskAcknowledged`、`schedule.enabled` 与 `schedule.apply` 后才可配置 live apply。具体 scheduler 与 destination 参数必须读取当前 OpenClaw 版本的实际 schema；本 Skill 不猜测、不自动注册任务。

每次已启用的定时运行必须由宿主注入 `deliverResult(result)` 交付端口，并获得 `{ "delivered": true }` 的确认回执。缺少回调、回调失败或没有确认时返回 `delivery_failed`，不得声称用户已收到运行报告。
