# 架构

[English](architecture.md)

这是独立 dsh 插件，作为消息通道与 profile 的应用入口并存。管理命令只配置和诊断，不启动 Agent。Harness 依赖保持外部发布版本 `0.1.7-alpha.2`。

## 连接与配置

`FeishuApi` 直接调用 HTTP API，管理 tenant access token 缓存、共享刷新、响应大小限制、超时和取消。回复按 Unicode 码点拆分，携带稳定 UUID。仅明确的 token 拒绝允许一次认证重试；回复失败不会重新提交任务。

`FeishuEvents` 使用官方 SDK 的 WebSocket 客户端和事件分发器。公开 HTTP 适配器管理连接发现请求，公开 Node Agent 管理握手和连接 socket。关闭时取消连接发现、强制关闭 SDK，并等待持有的请求和 socket 结束。畸形事件被隔离，日志不输出 SDK 的凭据或连接票据。

`account` 是实时配置对象，App Secret 标记为 secret。配置页通过 dsh 的已认证 Connection 和带修订号的 Settings 服务读写。扫码直接调用飞书官方应用注册 API，请求最小机器人权限，仅绑定明确返回的扫码用户身份。初始请求、轮询和等待均可取消且有时间上限，避免 SDK 注册辅助函数初始请求无法取消的问题。手动配置使用随机、限时、一次性的配对码。全程不读取 lark-cli 本地状态。

配置更新按代串行处理：中止旧连接，取消并等待任务和确认结束，再启动最新应用。未配置或连接失败不会关闭 Web 应用，用户仍能进入页面修复。

## 任务所有权

只接收人类用户的私聊文本，并在任务提交之前检查 allowedUsers。Session 哈希绑定应用命名空间、工作目录、私聊和发送者。每个 worker 持有一个 Agent handle、有限队列、任务期限及取消控制器。

新 Agent 在 setup 阶段通过公开 registry 挂载当前 preset；旧会话保留持久化 preset，并拒绝不兼容的工作目录和会话来源。持久化 user/message 与 inbox-splice 记录实现跨重启去重。中断后残留 inbox 不自动重放。`/dsh stop` 清空尚未执行的队列并取消当前任务。

## 进度与确认

已提交的 Session 事件驱动每个任务的一张进度卡片。内容仅包含助手公开说明、阶段标签、工具名称和成功/失败摘要。更新串行发送，最多保留一个待发送快照，网络慢时合并。最终文本单独发送，可拆分为多条有大小限制的回复。

Agent 作用域内的 approval 和 user-question waterfall 转为一次性交互卡片。回调必须同时匹配应用、原卡片、原私聊、发送者和随机 token；表单值按照该问题实际选项验证。超时、取消、配置切换、重启都会使请求失效。无法完整显示确认细节时不允许继续。上游审批策略先执行，`never` 不会被绕过。

## 依据与测试

实现依据[飞书官方 SDK](https://github.com/larksuite/node-sdk)及发布的 `dsh-agent`、`dsh-agent-preset-registry`、`dsh-session-query`、`dsh-settings`、`dsh-client-connection`、`dsh-client-ui-plugin-manager`、`dsh-user-approval`、`dsh-user-questions` 公开契约。

自动化使用隔离的假飞书 HTTP/WebSocket 服务、发布的真实 Agent 和安装 tarball 的真实 Web profile，不发送真实消息。
