# Feishu IM for dsh

[English](README.md) · [配置参考](docs/configuration.zh-CN.md) · [运行与排障](docs/operations.zh-CN.md)

在飞书机器人私聊中使用 dsh。插件直接调用飞书 OpenAPI，并用官方 Node SDK 接收长连接事件，**不需要安装 lark-cli**。

- 在 dsh 的 **插件 → dsh-feishu-im** 配置页扫码创建机器人，或输入 App ID / App Secret。
- 一次性配对码授权自己的飞书账号；只处理明确授权用户的私聊文本。
- 同一私聊保留会话历史，任务按顺序执行；不同用户的会话隔离。
- 进度卡片更新任务阶段、工具执行状态和助手公开说明，最终结果另发文本。不会转发原始推理块或工具输出。
- 需要确认或回答问题时，点击飞书交互卡片完成操作；支持单选、多选和补充文字。

## 安装

使用 Node.js `^22.19.0` 或 `>=24.0.0`。dsh 最低支持 **`0.1.5-rc.2`**，同时验证 `0.1.7-alpha.2`；已有 `0.1.5-rc.2` 无需升级。支持的预发布版本范围见[兼容说明](docs/compatibility.md)。

从本仓库构建安装包：

```sh
npm ci
npm run build
mkdir -p artifacts
npm pack --pack-destination artifacts
dsh plugin --profile web add "$PWD/artifacts/dsh-feishu-im-0.2.2.tgz"
```

这里必须使用绝对路径：dsh 在 profile 目录里运行 pnpm。直接写 `artifacts/package.tgz` 可能被当成 GitHub 仓库名，引发 `ERR_PNPM_GIT_RESOLVE_FAILED`；修改 GitHub 认证配置不能修复这个路径。

pnpm 11+ 可能提示 `protobufjs` 安装脚本待决定。dsh 插件页可选择“允许这些脚本并重试”。这个依赖的脚本只检查版本范围；也可以在对应 profile 的 `pnpm-workspace.yaml` 中明确设置 `allowBuilds.protobufjs: false` 后重试，插件已验证不依赖该脚本。不要覆盖文件里的其他配置。

重启 `dsh --profile web`，打开侧栏的**插件**，进入 **dsh-feishu-im**。插件与 Web 应用并存，不替换 dsh 的启动入口。

旧版 dsh 的配置入口是 **设置 → 插件 → feishu-im**。

## 连接机器人

先填写任务工作目录的绝对路径。不要选择 dsh 存放配置和凭据的 profile 目录。

**扫码：** 点击“扫码创建机器人 → 生成二维码”，使用飞书扫描并在手机上确认。此流程由飞书官方提供，可能受组织应用创建权限或管理员审批限制。成功后，插件保存应用凭据；官方返回扫码用户的 open_id 时，只授权该用户。未返回身份时，使用配对码完成授权。

**已有应用：** 在[飞书开发者后台](https://open.feishu.cn/app)创建企业自建应用，开启机器人能力，在“事件与回调”中选择**使用长连接接收事件**，配置下列内容并发布应用版本：

| 类型 | 标识 |
| --- | --- |
| 应用身份权限 | `im:message:send_as_bot`、`im:message.p2p_msg:readonly` |
| 接收消息事件 | `im.message.receive_v1` |
| 卡片回调 | `card.action.trigger` |

将 App ID、App Secret 填入配置页，点击“保存并连接”。Lark 国际版选择 Lark 区域。已保存密钥不会返回浏览器；同一个 App ID 的密钥输入框留空会保留原值。

状态变为“已连接”后，点击“生成授权配对码”，用自己的飞书账号私聊机器人，发送页面展示的 `/dsh pair …`。代码十分钟有效，仅可用一次。也可直接在配置页填写明确允许的用户 open_id。授权成功后，向机器人发送任务即可。

扫码配置预填权限和回调的能力仍受飞书平台开放范围影响。若扫码后不能接收消息或点击卡片，请到开发者后台核对上述设置、长连接模式和发布状态。无需用户 OAuth 登录或公网回调服务器。

## 使用

```text
检查这个项目的测试失败原因
/dsh status
/dsh stop
/dsh help
```

每个任务会使用当前 dsh 默认模型和 Agent preset。恢复已有会话时保留原 preset，防止工具能力悄悄变化。更换应用或工作目录会创建新的会话身份。

卡片只接受对应任务发起者在原私聊、原卡片上的操作。“允许本次”仅授权这一项操作；拒绝、取消、超时和重启都不会转为允许。dsh 的 `never` 审批策略仍然生效。无法完整展示的确认请求会拒绝继续，不会让用户盲目批准。

消息回复失败不会自动重做任务。断开长连接期间的消息补发由飞书决定；插件不能保证离线消息全部重放。

## 从 0.1 升级

0.2 移除了 `command`、`profile`、`maxRecordBytes` 和 `graceMs`。不读取或复制 lark-cli 的任何凭据。

建议将新版本安装到已有 Web profile，并在配置页重新输入凭据或扫码。移除旧 profile 中由 `dsh-feishu-im` 占用的 `headless-runner` 行；不要移除其他插件的 runner。profile 默认配置保存在 `id: feishu-im` 的 `config.account` 下；0.1.7 之前的 dsh 将页面配置保存到其 settings 文档的 `feishu-im.account` 命名空间。

旧会话需要原 Session 存储、原工作目录及显式的 `legacyNamespace`（旧 lark-cli profile 名）。preset-free 旧会话不能在 Web preset 下直接恢复；保留原始应用组合才能继续，或使用新会话。见[配置参考](docs/configuration.zh-CN.md)。

## 开发与验证

```sh
npm run check
npm run build
npm run test:integration
npm run package:check
```

集成测试将 tarball 安装到隔离的真实 dsh Web profile，用本地假飞书 HTTP/WebSocket 和假模型验证配置、授权、工具执行及重启去重；不会发送真实飞书消息。[架构](docs/architecture.zh-CN.md) · [兼容性](docs/compatibility.md) · [安全](SECURITY.md)
