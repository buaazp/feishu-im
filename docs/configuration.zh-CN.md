# 配置参考

[English](configuration.md) · [快速开始](../README.zh-CN.md)

Web 页面只提供「扫码创建机器人」和「绑定已有应用」，绑定仅填写 App ID / App Secret。旧版页面展开 **Feishu IM** 卡片，新版打开 **feishu-im** 行配置。默认目录 `~/dsh-workspaces/feishu-im` 自动创建，无需在表单中填写目录。区域、语言和显式授权名单属于下面的高级配置。

插件添加 `feishu-im` 行，`config.account` 是一个整体原子更新的实时配置。页面先验证机器人凭据，再通过 dsh 保存。0.1.7 使用 profile 配置（权限 `0600`）；旧版使用 dsh SettingsProvider 管理的 settings 文档（默认 `$DSH_HOME/settings.yaml`）中的 `feishu-im.account`，优先于 profile 默认配置。旧版同一 DSH_HOME 下的 profile 共享此命名空间；不同机器人应使用不同 DSH_HOME。配置目录应放在机器人工作目录之外，不要提交到 Git。空凭据表示尚未配置，不会阻止 dsh 启动。

```yaml
- id: feishu-im
  config:
    account:
      appId: cli_0123456789abcdef
      appSecret: 请在配置页填写真实密钥
```

| `account` 中的字段 | 默认值 | 含义 |
| --- | --- | --- |
| `appId` | 空 | 企业自建应用 App ID。 |
| `appSecret` | 空 | 应用密钥；配置查询不会返回此字段。 |
| `apiOrigin` | `https://open.feishu.cn` | 飞书，或国际版 `https://open.larksuite.com`。仅为隔离测试接受回环 HTTP 地址。 |
| `locale` | `zh-CN` | 控制消息语言，可选 `zh-CN`、`en`；不改变模型回答语言。 |
| `cwd` | `~/dsh-workspaces/feishu-im` | 默认值展开为宿主用户 home 下的绝对路径并自动创建；旧的空字符串使用此默认值。显式目录须为绝对路径、已存在、可读写且位于 profile 之外。仅作为新私聊的初始目录。 |
| `allowedUsers` | `[]` | 明确授权的人类用户 open_id；空数组不允许任何人执行任务。 |
| `legacyNamespace` | 空 | 为恢复旧会话而显式提供的 0.1 CLI profile 名；不导入凭据。 |
| `maxConversations` | `4` | 同时活动的私聊会话上限；保留的空闲任务不占此限额。 |
| `maxPendingMessages` | `16` | 每个会话尚未开始的任务队列上限。 |
| `maxConcurrentReplies` | `8` | 控制和错误回复的并发上限。 |
| `maxReplyBytes` | `12000` | 每条 Markdown 富文本回复完整 JSON 内容的 UTF-8 字节上限，范围 64–16000。 |
| `startupTimeoutMs` | `30000` | 首次连接就绪超时。 |
| `requestTimeoutMs` | `30000` | 每次 HTTP 请求超时。 |
| `taskTimeoutMs` | `600000` | 一次任务及其工具、确认操作的总时间上限。 |
| `progressIntervalMs` | `1000` | 关键节点卡片快照的最小更新间隔；发送慢时合并待更新内容。 |
| `interactionTimeoutMs` | `300000` | 交互卡片有效时间；任务取消会提前结束请求。 |

页面保存同一应用时保留现有授权，更换应用默认清空授权。没有授权用户时，页面保存后自动展示十分钟有效、仅可使用一次的 `/dsh pair …`；用户仍须在机器人私聊中主动发送。直接填写以上 profile 配置或使用 CLI 后，在页面生成配对码，或通过 `allowedUsers` / `--allow-user` 明确授权。未授权时不会执行任何任务。

数量与毫秒限制均须为正整数。更换配置时，插件会先取消并等待旧通道、任务、交互请求结束，再连接新应用。磁盘会话保留。保存使用 dsh 配置修订号，过期页面不能覆盖新凭据或授权名单。

任务完成或停止后保留在「未分组」，普通消息继续当前任务。`/dsh status` 显示当前目录；`/dsh cd` 支持绝对路径、相对当前聊天目录的路径及 `~`，运行结束后才能切换。修改配置中的 `cwd` 不改变已有聊天目录。

应用命名空间、私聊 ID 和用户 open_id 确定持久聊天绑定；初次连接继续兼容由应用、默认目录和参与者生成的旧 Session 身份。`/dsh new` 和 `/dsh cd` 切换到独立 Session，旧任务不归档。`/dsh archive` 使用 dsh 原生归档集合。绑定、目录、跨任务去重记录和未完成的归档操作保存在 dsh 的 `feishu_im` storage domain，与模型历史分开。备份时同时保留此 domain、Workspace 状态和 Session 存储。持久化消息 ID 保持 `lark:<message_id>`，便于兼容旧去重记录。`legacyNamespace` 只替换会话哈希的应用部分，不迁移 preset 组合或会话存储。没有 preset 的旧会话只能在原来没有 preset 的应用组合中继续。

可选管理命令不会启动 Agent：

```sh
# 通过 stdin 提供密钥，不要将密钥放入命令行参数。
# 替换为自己使用的密钥提供命令、目录和 ID。
secret-provider | dsh plugin --profile web exec feishu-im setup \
  --app-id cli_0123456789abcdef --secret-stdin \
  --workspace /absolute/task/workspace --allow-user ou_EXPLICIT_HUMAN

dsh plugin --profile web exec feishu-im doctor --json
dsh plugin --profile web exec feishu-im reset
```

`--workspace` 可省略，此时自动创建并使用默认目录。重复配置同一应用且省略 `--allow-user` 时保留 profile 中的授权名单，更换应用则默认为空名单。需要显式授权时可重复提供 `--allow-user`，或用逗号分隔多个 open_id。

`setup` 还支持 `--locale`、`--lark`、`--legacy-namespace`。CLI 修改后重启 dsh；扫码和实时修改请使用配置页。`doctor` 检查配置、目录及机器人身份，不发消息，也不开启事件连接。`reset` 仅删除插件配置覆盖行，保留 Session 历史。

旧版 dsh 的 `setup`、`doctor`、`reset` 仅管理或检查 profile 覆盖行，不修改 settings 文档中的页面配置。页面已保存配置时，请继续在页面修改，并用“断开并清除凭据”移除密钥。升级 dsh 前记录非密钥设置，在新版页面重新配置；本插件不自动复制不同版本的凭据或转换宿主的 Session 格式。
