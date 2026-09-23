# 配置参考

[English](configuration.md) · [快速开始](../README.zh-CN.md)

插件添加 `feishu-im` 行，`config.account` 是一个整体原子更新的实时配置。页面先验证机器人凭据，再通过 dsh 保存。0.1.7 使用 profile 配置（权限 `0600`）；旧版使用 dsh SettingsProvider 管理的 settings 文档（默认 `$DSH_HOME/settings.yaml`）中的 `feishu-im.account`，优先于 profile 默认配置。旧版同一 DSH_HOME 下的 profile 共享此命名空间；不同机器人应使用不同 DSH_HOME。配置目录应放在机器人工作目录之外，不要提交到 Git。空凭据表示尚未配置，不会阻止 dsh 启动。

```yaml
- id: feishu-im
  config:
    account:
      appId: cli_0123456789abcdef
      appSecret: 请在配置页填写真实密钥
      cwd: /absolute/task/workspace
      allowedUsers:
        - ou_EXPLICIT_HUMAN
```

| `account` 中的字段 | 默认值 | 含义 |
| --- | --- | --- |
| `appId` | 空 | 企业自建应用 App ID。 |
| `appSecret` | 空 | 应用密钥；配置查询不会返回此字段。 |
| `apiOrigin` | `https://open.feishu.cn` | 飞书，或国际版 `https://open.larksuite.com`。仅为隔离测试接受回环 HTTP 地址。 |
| `locale` | `zh-CN` | 控制消息语言，可选 `zh-CN`、`en`；不改变模型回答语言。 |
| `cwd` | 空 | 任务绝对工作目录，应可读写并位于 profile 之外。 |
| `allowedUsers` | `[]` | 明确授权的人类用户 open_id；空数组不允许任何人执行任务。 |
| `legacyNamespace` | 空 | 为恢复旧会话而显式提供的 0.1 CLI profile 名；不导入凭据。 |
| `maxConversations` | `4` | 同时活动的私聊会话上限。 |
| `maxPendingMessages` | `16` | 每个会话尚未开始的任务队列上限。 |
| `maxConcurrentReplies` | `8` | 控制和错误回复的并发上限。 |
| `maxReplyBytes` | `12000` | 每条文本回复 JSON 内容的 UTF-8 字节上限，范围 64–16000。 |
| `startupTimeoutMs` | `30000` | 首次连接就绪超时。 |
| `requestTimeoutMs` | `30000` | 每次 HTTP 请求超时。 |
| `taskTimeoutMs` | `600000` | 一次任务及其工具、确认操作的总时间上限。 |
| `progressIntervalMs` | `1000` | 关键节点卡片快照的最小更新间隔；发送慢时合并待更新内容。 |
| `interactionTimeoutMs` | `300000` | 交互卡片有效时间；任务取消会提前结束请求。 |

数量与毫秒限制均须为正整数。更换配置时，插件会先取消并等待旧通道、任务、交互请求结束，再连接新应用。磁盘会话保留。保存使用 dsh 配置修订号，过期页面不能覆盖新凭据或授权名单。

应用 ID、工作目录、私聊 ID 和用户 open_id 一起确定 Session 身份。持久化消息 ID 保持 `lark:<message_id>`，便于兼容旧去重记录。`legacyNamespace` 只替换会话哈希的应用部分，不迁移 preset 组合或会话存储。没有 preset 的旧会话只能在原来没有 preset 的应用组合中继续。

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

`setup` 还支持 `--locale`、`--lark`、`--legacy-namespace`。CLI 修改后重启 dsh；扫码和实时修改请使用配置页。`doctor` 检查配置、目录及机器人身份，不发消息，也不开启事件连接。`reset` 仅删除插件配置覆盖行，保留 Session 历史。

旧版 dsh 的 `setup`、`doctor`、`reset` 仅管理或检查 profile 覆盖行，不修改 settings 文档中的页面配置。页面已保存配置时，请继续在页面修改，并用“断开并清除凭据”移除密钥。升级 dsh 前记录非密钥设置，在新版页面重新配置；本插件不自动复制不同版本的凭据或转换宿主的 Session 格式。
