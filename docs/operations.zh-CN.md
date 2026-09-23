# 运行与排障

[English](operations.md)

安装到实际使用的 dsh Web profile，重启后在**插件 → dsh-feishu-im** 配置。保持 dsh 运行才能接收长连接消息。[systemd 示例](../examples/feishu-im.service)启动 Web profile，请按机器调整用户、程序及工作目录。

| 现象 | 检查方式 |
| --- | --- |
| 找不到配置页 | 确认安装了构建后的 tarball、启用了插件，并重启了实际使用的 profile。 |
| 本地包提示 `ERR_PNPM_GIT_RESOLVE_FAILED` | 改用安装包绝对路径。dsh 在 profile 目录中调用 pnpm，裸写 `artifacts/file.tgz` 可能被误认成 GitHub 仓库。 |
| pnpm 阻止安装 | 在插件页决定 `protobufjs` 脚本后重试，或在 profile 的 `pnpm-workspace.yaml` 明确禁用这个可选版本检查脚本。 |
| 扫码失败 | 可能受组织权限、审批或平台开放范围限制；重试或使用已有企业自建应用。 |
| 凭据验证失败 | 核对 App ID、App Secret、飞书/Lark 区域及机器人能力。 |
| 已连接但无回复 | 发布应用，设置用户可用范围，订阅 `im.message.receive_v1`，使用私聊文本并完成发送者配对。 |
| 点击卡片无效 | 为 `card.action.trigger` 配置长连接；必须是任务发起人点击原卡片，请求也不能过期。 |
| 配对失败 | 刷新配置页并生成新配对码；其他配置修改可能使旧修订号失效。 |
| 任务等待中 | 查看进度或确认卡片；`/dsh status` 查看队列，`/dsh stop` 取消。 |
| 模型或工具报错 | 先在 Web 中确认 dsh 默认模型凭据与当前 Agent preset 正常。 |
| 拒绝恢复旧会话 | 恢复其原工作目录和 preset 组合，或使用新会话命名空间。 |
| 最终回复失败 | 任务可能已经完成。先查看 dsh Session 历史，再明确提出后续任务。 |

通过 `dsh plugin --profile web exec feishu-im doctor --json` 检查配置、工作目录及直接机器人身份认证，不发送真实消息。doctor 无法证明事件订阅与应用发布状态，需要用户发一条私聊消息验证。

停止 dsh 或更换配置时会取消并等待持有的工作结束。重启后旧卡片不能授权新任务。保留 Session 存储才能保留去重记录。飞书断线期间的事件补发和回复持久化不由本插件保证。

只有已登录 dsh 的操作者能修改配置和查看配对码。不要共享登录链接、profile 文件或 App Secret。获得机器人授权相当于能使用该 dsh 部署允许的工具。密钥泄露后应在开发者后台轮换，并在配置页保存新密钥。
