# 运行与排障

[English](operations.md)

安装到实际使用的 dsh Web profile，重启后打开**插件 → dsh-feishu-im** ，在插件介绍与「包含的组件」之间直接配置。旧版 dsh 在**设置 → 插件 → Feishu IM** 展开卡片。选择扫码创建机器人或绑定已有应用；绑定只需 App ID / App Secret，默认任务目录 `~/dsh-workspaces/feishu-im` 自动创建。保持 dsh 运行才能接收长连接消息。[systemd 示例](../examples/feishu-im.service)启动 Web profile，请按机器调整用户、程序及工作目录。

| 现象 | 检查方式 |
| --- | --- |
| 找不到配置页 | 确认安装了构建后的 tarball、启用了插件，并重启了实际使用的 profile。 |
| 本地包提示 `ERR_PNPM_GIT_RESOLVE_FAILED` | 改用安装包绝对路径。dsh 在 profile 目录中调用 pnpm，裸写 `artifacts/file.tgz` 可能被误认成 GitHub 仓库。 |
| pnpm 阻止安装 | 在插件页决定 `protobufjs` 脚本后重试，或在 profile 的 `pnpm-workspace.yaml` 明确禁用这个可选版本检查脚本。 |
| Desktop 提示与 dsh `0.2.0-rc.2` 不兼容 | 安装明确支持该运行时的插件 `0.2.4` 或更新版本；`0.2.3` 只声明支持 0.1.x。核对 Desktop 实际运行时版本，它可能与终端 CLI 不同；已测试组合无需开启兼容性豁免。 |
| CLI 提示 `desktop` profile 仅由 Electron 应用管理 | 通过 Desktop 插件管理安装本地 tarball；外部 CLI 不允许修改这个 profile。 |
| 扫码失败 | 可能受组织权限、审批或平台开放范围限制；重试或使用已有企业自建应用。 |
| 凭据验证失败 | 核对 App ID、App Secret 及机器人能力；Lark 国际版在高级配置中使用 `apiOrigin: https://open.larksuite.com`。 |
| 已连接但无回复 | 发布应用，设置用户可用范围，订阅 `im.message.receive_v1`，使用私聊文本并完成发送者配对。 |
| 点击卡片无效 | 为 `card.action.trigger` 配置长连接；必须是任务发起人点击原卡片，请求也不能过期。 |
| 配对失败 | 无授权用户时，使用页面保存后自动展示的配对码，也可重新生成。十分钟内在机器人私聊中发送；其他配置修改可能使旧修订号失效。 |
| 任务等待中 | 查看进度或确认卡片；`/dsh status` 查看队列，`/dsh stop` 取消。 |
| 任务完成后要继续 | 任务保留在「未分组」；直接发普通消息继续，`/dsh new` 新建，`/dsh archive` 显式归档。 |
| 更换项目目录 | `/dsh cd 路径`；目录必须已存在、可读写且位于 profile 之外。运行中先 `/dsh stop`，等待停止后再切换。 |
| Markdown 显示异常 | 确认已安装新构建；回复应是富文本 `post`。更新飞书客户端；极长表格跨消息时可能分开显示。 |
| 模型或工具报错 | 先在 Web 中确认 dsh 默认模型凭据与当前 Agent preset 正常。 |
| 拒绝恢复旧会话 | 恢复其原工作目录和 preset 组合，或用 `/dsh new` 开始新任务。 |
| 最终回复失败 | 任务可能已经完成。先查看 dsh Session 历史，再明确提出后续任务。 |

通过 `dsh plugin --profile web exec feishu-im doctor --json` 检查配置、工作目录及直接机器人身份认证，不发送真实消息。doctor 无法证明事件订阅与应用发布状态，需要用户发一条私聊消息验证。

停止 dsh 或更换配置时会取消并等待持有的工作结束。重启后旧卡片不能授权新任务。同时保留 `feishu_im` storage domain、Workspace 状态与 Session 存储，才能恢复目录、当前任务、归档和完整去重记录。飞书断线期间的事件补发和回复持久化不由本插件保证。

只有已登录 dsh 的操作者能修改配置和查看配对码。不要共享登录链接、profile 文件或 App Secret。获得机器人授权相当于能使用该 dsh 部署允许的工具。密钥泄露后应在开发者后台轮换，并在配置页保存新密钥。

安装时仅有 Harness `missing peer` 警告，且插件安装成功时，先按兼容表核对 dsh 版本。dsh 在运行时提供这些外部依赖；profile 默认 `autoInstallPeers: false`。不要为消除警告另装一套 Harness。
