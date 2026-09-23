# 配置参考

[English](configuration.md) · [快速开始](../README.zh-CN.md)

通过 `dsh plugin --profile feishu exec feishu-im setup` 配置 profile。向导只合并自己的 runner 参数，保留其他 YAML 行、注释和 `!!js` 表达式。更新采用锁、私有临时文件及原子替换；检测到外部编辑时会报错。修改前先停止 dsh，完成后重新启动。

## Profile 配置文件

用户配置通常位于 `~/.dsh/profiles/feishu/cordis.patch.yml`；设置 `DSH_HOME` 后使用对应根目录。安装包创建 runner，向导生成如下覆盖配置：

```yaml
- id: headless-runner
  name: dsh-feishu-im
  disabled: false
  config:
    profile: YOUR_APP_PROFILE
    command: [lark-cli]
    cwd: /absolute/task/directory
    allowedUsers: [ou_YOUR_HUMAN_OPEN_ID]
    locale: zh-CN
```

`headless-runner` 是 dsh 启动审计识别的应用启动器 id，实际模块为 `dsh-feishu-im`。保留这两个名称，不要重复添加 runner。此插件应使用专用 profile。

## 参数

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `profile` | 必填 | 已有 lark-cli 应用配置名称，接收和回复均使用它 |
| `cwd` | 必填 | 已存在的任务目录绝对路径；从该目录启动 dsh |
| `allowedUsers` | 必填 | 该应用下授权人类用户的 `ou_...` 列表，不可为空 |
| `command` | `[lark-cli]` | 可执行文件及固定参数，不经过 shell 展开 |
| `locale` | `zh-CN` | 控制提示语言：`zh-CN` 或 `en`；不改变模型答复语言 |
| `maxConversations` | `4` | 同时运行的会话上限 |
| `maxPendingMessages` | `16` | 每个会话等待启动的消息上限 |
| `maxConcurrentReplies` | `8` | 状态、排队及错误提示的并发回复上限 |
| `maxRecordBytes` | `1048576` | 单条 CLI NDJSON 记录或 RPC 收集流的字节上限 |
| `maxReplyBytes` | `12000` | 完整回复 JSON 内容的 UTF-8 字节数上限，范围 64–16000 |
| `startupTimeoutMs` | `30000` | 等待事件就绪标记的超时毫秒数 |
| `requestTimeoutMs` | `30000` | 单次回复请求的超时毫秒数 |
| `taskTimeoutMs` | `600000` | 单条任务及其续轮的超时毫秒数 |
| `graceMs` | `3000` | 子进程关闭宽限毫秒数，之后由进程管理服务终止 |

除回复字节数的单独范围外，上限和时长均为不超过 2147483647 的正整数。队列或会话满时，用户需稍后重发；控制回复本身达到并发上限时也可能被丢弃，日志会记录该情况。

`--allow-user` 支持多次传入或用逗号分隔，向导会去重。向导发现的登录身份仅作为建议，必须明确回答后才授权；非交互运行必须传入白名单。服务管理器 PATH 不同时，用 `--lark-command /absolute/path/to/lark-cli` 指定绝对路径。

高级参数直接修改 YAML。管理命令验证字面量 runner 配置；runner 内部的动态表达式需手动维护，`doctor` 可能无法解析。其他配置行的表达式会被保留。向导拒绝修改符号链接形式的 patch，需自行维护其目标文件。

## 模型与权限

插件继承所属 dsh profile 的模型提供方、凭据、工具、skills 和权限，不会自动复制其他 profile 的模型选择。基础默认值是 `deepseek-official / deepseek-flash`。使用 dsh 凭据存储，或通过环境变量提供 `DEEPSEEK_API_KEY`；不要将密钥提交到仓库或配置示例。

选择已注册的其他模型时，添加独立覆盖行：

```yaml
- id: agent-default-model
  config:
    provider: YOUR_REGISTERED_PROVIDER
    model: YOUR_MODEL_ID
```

对应 provider 注册及凭据引用也必须存在于本 profile 中。具体配置见 [Harness 文档](https://github.com/deepseek-ai/deepseek-harness)。`doctor` 只验证飞书机器人身份，不验证模型凭据或工具权限。

基础工作区权限根目录来自启动 dsh 时的当前目录，因此应先执行 `cd /absolute/task/directory`，再运行 `dsh --profile feishu`。所有授权用户共享这个目录及其权限。插件没有远程工具审批按钮，应为无人值守任务保留合适的权限策略。

## 历史连续性

会话 id 由 lark-cli profile 名称、任务目录、私聊 id 和用户 id 共同决定。修改任一项会选择不同历史。相同配置、相同 Session 存储下重新安装插件可继续原对话；重置和卸载不会删除 Session 文件。
