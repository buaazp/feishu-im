# 运维与排障

[English](operations.md) · [快速开始](../README.zh-CN.md)

## 启动、停止和进程托管

从配置的任务目录执行 `dsh --profile feishu`。以日志 `feishu-im: ready for private messages` 判断事件订阅就绪，不用固定延时推测。Ctrl+C 或 SIGTERM 会取消并等待插件拥有的任务结束。插件保持事件消费者 stdin 打开，关闭时以 EOF 请求正常退出，不会停止其他消费者共享的 lark-cli 事件总线。

服务应使用拥有 lark-cli 凭据的同一系统账号，PATH 能找到 Node、pnpm、dsh 和 lark-cli，工作目录设为 `cwd`。密钥通过受保护的环境文件或 dsh 凭据存储提供。[Linux 用户服务示例](../examples/feishu-im.service)需要先修改路径；项目不会自动安装系统服务。

每个应用只运行一个任务驱动实例。飞书事件投递不是分布式任务队列，多处监听可能竞争或重复执行。配置修改后重启。重连由 lark-cli 负责；事件消费者失败时 dsh 以非零状态退出，便于进程管理器重启。

## 排查步骤

```sh
dsh plugin --profile feishu exec feishu-im doctor
dsh plugin --profile feishu exec feishu-im doctor --json
lark-cli --profile YOUR_APP_PROFILE event status --json
```

仅当配置、目录权限和机器人身份都通过时，`doctor` 才返回 0。它不会发送消息、调用模型或建立事件连接。继续检查启动日志，再发送 `/dsh help` 验证真实往返。

| 现象 | 处理 |
| --- | --- |
| 找不到 `pnpm` 或 `lark-cli` | 安装前置工具，检查服务账号的 PATH；可用 `--lark-command` 配置 CLI 绝对路径。 |
| 机器人不可用或用户 token 过期 | 单独检查 `identities.bot`。用户 OAuth 过期不影响机器人链路；修复机器人凭据或能力，不要为此重新登录用户。 |
| 权限不足 / missing scopes | 根据 lark-cli 返回的权限，在飞书后台开通并发布；机器人权限不通过用户 OAuth 登录解决。 |
| 已存在远端事件连接 | 正常停止另一处监听，不要强制终止其他消费者。确认自己拥有的总线已空闲时，可运行 `lark-cli --profile YOUR_APP_PROFILE event stop`。 |
| 没有 ready 日志 | 查看 dsh stderr 中的 CLI 启动、连接、认证和订阅错误，检查应用长连接配置。 |
| 已 ready，但消息被忽略 | 用白名单内的人类账号发送新的私聊文本，核对应用下的 open_id。机器人消息、群聊、附件均忽略；离线消息不补拉。 |
| 确认开始后任务失败 | 检查模型提供方、凭据及 dsh 工具日志，确认从任务目录启动。 |
| 卡在工具审批 | 当前没有飞书审批界面；停止任务，在本地检查权限设置。 |
| 结果回复失败 | 先检查 Session 和日志，再决定是否重发；工具可能已经执行，不会自动重跑任务，也没有持久化回复重试队列。 |
| 提示另一个配置命令正在运行 | 等待原命令结束。如果它已崩溃，确认没有 setup/reset 进程，再移除该 profile 内空的 `.feishu-im-setup.lock` 目录并重试。 |
| 原生辅助程序或依赖构建失败 | 查看具体包的安装日志和 dsh/pnpm 构建审批说明，仅允许确实需要的脚本；不要通过关闭沙箱或全局放开脚本绕过。 |

日志可能包含任务细节、路径、消息 id 和模型错误；Session 包含对话和工具数据。反馈问题前请脱敏，不要在 issue 中粘贴密钥或完整认证输出。

## 投递和故障恢复限制

已持久化的接收记录可阻止同一消息 id 再次执行，但无法保证崩溃前后的任意工具副作用严格只发生一次。尚未接收持久化的内存队列可能丢失，需检查历史后决定重发。中断的已接收消息不会自动重跑；新的消息会继续原会话。

`/dsh stop` 清空排队消息并取消当前任务，不能撤销已完成的工具动作。长回复会拆成有确定性幂等键的纯文本消息；后续分片失败时仍可能只投递一部分。

## 升级与卸载

先停止 dsh，备份 profile 配置和 Session 存储，检查目标版本[兼容性](compatibility.md)。向同一个 profile 安装新 tarball，运行 `doctor`，重启并发一个小任务。dsh Session 格式可能随版本变化，回退插件不代表旧 Harness 一定能读取新格式数据。

卸载前停止进程，然后执行：

```sh
dsh plugin --profile feishu exec feishu-im reset
dsh plugin --profile feishu remove dsh-feishu-im
```

重置只删除插件自己的 runner 覆盖行，卸载再移除 bundle 依赖；其他 profile 配置和 Session 文件保留。bundle 尚在但配置已重置时，启动会明确失败，需重新运行 setup。
