# 架构

[English](architecture.md)

这是独立 dsh 插件，作为消息通道与 profile 的应用入口并存。管理命令只配置和诊断，不启动 Agent。Harness 依赖保持外部发布版本，最低支持 dsh `0.1.5-rc.2`。

## 连接与配置

`FeishuApi` 直接调用 HTTP API，管理 tenant access token 缓存、共享刷新、响应大小限制、超时和取消。回复使用飞书 `post` 的独占行 `md` 元素。分段按完整 JSON 字节预算、优先完整行；长代码围栏会关闭并在下一段按原语言重新开启。保留 Unicode 码点和确定性回复 UUID。仅明确的 token 拒绝允许一次认证重试；回复失败不会重新提交任务。

`FeishuEvents` 使用官方 SDK 的 WebSocket 客户端和事件分发器。公开 HTTP 适配器管理连接发现请求，公开 Node Agent 管理握手和连接 socket。关闭时取消连接发现、强制关闭 SDK，并等待持有的请求和 socket 结束。畸形事件被隔离，日志不输出 SDK 的凭据或连接票据。

兼容层在旧版 dsh 使用公开 SettingsScope register/get/watch，在 0.1.7 使用 volatile Config/SettingsForms；两者都按修订号实时更新 `account`，App Secret 标记为 secret。旧版 settings 命名空间入口使用带展开箭头的卡片，新版插件页只贡献行配置入口，避免重复表单；不存在的入口不会激活。配置页通过 dsh 的已认证 Connection 和带修订号的 Settings 服务读写。

页面只提供「扫码创建机器人」和「绑定已有应用」。扫码直接调用飞书官方应用注册 API，请求最小机器人权限，仅绑定明确返回的扫码用户身份。初始请求、轮询和等待均可取消且有时间上限。绑定已有应用只需 App ID / App Secret；同一应用保留已授权用户，更换应用默认清空授权。没有授权用户时，页面保存后自动提供随机、限时、单次配对码，仍须由用户在机器人私聊中主动发送才能授权。默认目录为自动创建的 `~/dsh-workspaces/feishu-im`；显式目录必须已存在、可读写且位于 profile 之外。全程不读取 lark-cli 本地状态。

配置更新按代串行处理：中止旧连接，取消并等待任务和确认结束，再启动最新应用。未配置或连接失败不会关闭 Web 应用，用户仍能进入页面修复。

## 任务所有权

只接收人类用户的私聊文本，并在任务提交之前检查 `allowedUsers`。`feishu_im` storage domain 持久保存应用命名空间、私聊及用户到当前目录和 Session 的绑定。首次 Session 身份兼容原先包含工作目录的会话哈希。每个 worker 持有一个 Agent handle、有限队列、任务期限及取消控制器。Agent 空闲后继续保留句柄，不自动加入 Workspace，因此完成或停止的任务留在「未分组」，且不占活动并发名额。

新 Agent 在 setup 阶段通过公开 registry 挂载当前 preset；旧会话保留持久化 preset，并拒绝不兼容的工作目录和会话来源。消息准入记录在 followup 产生任务副作用前持久保存，支持跨任务切换及重启去重；旧 Session 的 user/message 与 inbox-splice 记录仍用于迁移已有准入记录。中断后残留 inbox 被清空，不自动重放。

普通消息继续当前任务。`/dsh stop` 清空尚未执行的队列并取消当前运行，保留任务。`/dsh new` 和 `/dsh cd` 为下一条消息持久选定新 Session，旧任务保留；运行未结束时必须先停止或等待。`/dsh cd` 只修改当前私聊的目录，不改变其他聊天的默认目录。`/dsh archive` 先取消并等待执行结束，持久保存归档意图，再通过公开 Workspace API 归档并释放句柄；未完成的归档会在后续准入前恢复。关闭或重配时等待所有准入、任务、交互和回复，释放持有句柄并关闭 storage domain。

## 进度与确认

已提交的 Session 事件驱动每个任务的一张进度卡片。通过对应的 `agent/inbox/claimed` 和 `turn/end` 确定飞书任务轮次的边界，避免同一 Agent 后续网页任务的输出或确认混入飞书聊天。内容仅包含助手公开说明、阶段标签、工具名称和成功/失败摘要。更新串行发送，最多保留一个待发送快照，网络慢时合并。最终文本单独发送，可拆分为多条有大小限制的 Markdown 富文本回复。

Agent 作用域内的 approval 和 user-question waterfall 转为一次性交互卡片。回调必须同时匹配应用、原卡片、原私聊、发送者和随机 token；表单值按照该问题实际选项验证。超时、取消、配置切换、重启都会使请求失效。无法完整显示确认细节时不允许继续。上游审批策略先执行，`never` 不会被绕过。

## 依据与测试

实现依据以下公开契约：

- [飞书官方 SDK](https://github.com/larksuite/node-sdk)：WSClient、EventDispatcher 和 registerApp。
- 发布的 `dsh-agent`、`dsh-agent-presets` / `dsh-agent-preset-registry`、`dsh-session-query`：Agent 所有权及持久历史。
- 发布的 `dsh-storage-domain`、`dsh-workspace`：持久聊天路由、准入记录和显式归档；旧版与新版宿主均使用公开的 `storageDomain.open` 和 `workspaceRegistry.archiveSession`。
- 发布的 `dsh-settings`、`dsh-client-connection`、`dsh-client-ui-slots`：配置存储、已认证的浏览器传输和插件配置入口。
- 发布的 `dsh-user-approval`、`dsh-user-questions`：Agent 作用域内的交互协议。

自动化使用隔离的假飞书 HTTP/WebSocket 服务、发布的真实 Agent 和安装 tarball 的真实 Web profile，不发送真实消息。
