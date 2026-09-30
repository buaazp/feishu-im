# Feishu IM for dsh

[English](README.md) · [图文配置指南](#连接机器人) · [配置参考](docs/configuration.zh-CN.md) · [运行与排障](docs/operations.zh-CN.md)

在飞书机器人私聊中使用 dsh。插件直接调用飞书 OpenAPI，并用官方 Node SDK 接收长连接事件，**不需要安装 lark-cli**。

- 配置页只有「扫码创建机器人」和「绑定已有应用」；绑定只需 App ID / App Secret，默认工作目录自动创建。
- 一次性配对码授权自己的飞书账号；只处理明确授权用户的私聊文本。
- 任务完成后保留在「未分组」，普通消息继续当前任务；聊天指令可新建、归档和切换目录，不同用户相互隔离。
- 进度卡片更新任务阶段、工具执行状态和助手公开说明，最终结果以飞书富文本 Markdown 单独发送。不会转发原始推理块或工具输出。
- 需要确认或回答问题时，点击飞书交互卡片完成操作；支持单选、多选和补充文字。

## 安装

使用 Node.js `^22.19.0` 或 `>=24.0.0`。dsh 最低支持 **`0.1.5-rc.2`**，同时验证 `0.1.7-alpha.2` 和 Desktop 使用的 **`0.2.0-rc.2`**；已有 `0.1.5-rc.2` 无需升级。支持的预发布版本范围见[兼容说明](docs/compatibility.md)。

从本仓库构建安装包：

```sh
npm ci
npm run build
mkdir -p artifacts
npm pack --pack-destination artifacts
dsh plugin --profile web add "$PWD/artifacts/dsh-feishu-im-0.2.5.tgz"
```

这里必须使用绝对路径：dsh 在 profile 目录里运行 pnpm。直接写 `artifacts/package.tgz` 可能被当成 GitHub 仓库名，引发 `ERR_PNPM_GIT_RESOLVE_FAILED`；修改 GitHub 认证配置不能修复这个路径。

使用 **DSH Desktop** 时，通过 Desktop 的插件管理安装 `artifacts/dsh-feishu-im-0.2.5.tgz`，目标是 Desktop 实际运行的 profile。Desktop 内置的 dsh 版本可能与终端的 `dsh --version` 不同。0.2.5 已声明支持经过测试的 `0.2.0-rc.2`，无需开启兼容性豁免；上面的命令安装到独立的 Web profile。

pnpm 11+ 可能提示 `protobufjs` 安装脚本待决定。dsh 插件页可选择“允许这些脚本并重试”。这个依赖的脚本只检查版本范围；也可以在对应 profile 的 `pnpm-workspace.yaml` 中明确设置 `allowBuilds.protobufjs: false` 后重试，插件已验证不依赖该脚本。不要覆盖文件里的其他配置。

安装到 Web profile 后，重启 `dsh --profile web`，再按照下面的图文步骤配置。插件与 Web 应用并存，不替换 dsh 的启动入口。

## 连接机器人

配置分为三步：**打开配置页 → 连接机器人 → 授权自己的飞书账号**。Desktop 和 Web 支持相同的连接方式，在实际使用的 profile 中配置即可。

### 1. 打开配置页

| 使用环境 | 配置入口 |
| --- | --- |
| Desktop / 新版 Web | 侧栏 **插件 → dsh-feishu-im**，配置区域位于插件介绍与「包含的组件」之间。 |
| 旧版 Web，例如 dsh `0.1.5-rc.2` | **设置 → 插件 → 插件配置 → Feishu IM**，点击卡片或右侧箭头展开。 |

**Desktop：在插件详情页绑定已有应用。** 只需填写 App ID 和 App Secret。

![Desktop 插件详情页：插件介绍下方显示两种连接方式、App ID 和 App Secret 输入框，以及保存并连接按钮](docs/screenshots/desktop-plugin-settings.png)

**Web：在内置插件设置旁展开 Feishu IM 卡片。**

![Web 设置中的插件页：Feishu IM 卡片与终端等内置插件排列在一起，右侧箭头可展开配置](docs/screenshots/web-plugin-settings.png)

截图来自插件 `0.2.5` 的中文界面：Desktop 使用 dsh `0.2.0-rc.2`，Web 使用 `0.1.5-rc.2`。已裁剪无关区域、遮去应用和用户标识，并用 `~` 简写用户主目录。图中展示的是已连接状态，首次使用请继续完成以下步骤。

### 2. 选择一种连接方式

| 方式 | 需要准备 | 操作 |
| --- | --- | --- |
| **扫码创建机器人** | 手机飞书，以及组织内创建应用的权限 | 生成二维码，用飞书扫描并在手机上确认。 |
| **绑定已有应用** | 已发布的飞书机器人应用、App ID 和 App Secret | 填写两个字段，点击「保存并连接」。 |

**扫码创建机器人：** 点击「扫码创建机器人 → 生成二维码」，使用飞书扫描生成的二维码，并在手机上确认。成功后自动保存应用凭据。此流程由飞书官方提供，可能受组织应用创建权限或管理员审批限制；未开放时可绑定已有应用。

![展开后的 Web 飞书配置：扫码创建机器人、生成二维码、默认任务工作目录、已授权用户和生成授权配对码按钮](docs/screenshots/web-bot-connection.png)

官方返回扫码用户的 open_id 时，只授权该用户；未返回身份时，按第 3 步配对。扫码预填权限和回调的能力受飞书平台开放范围影响。若扫码后不能接收消息或点击卡片，请到开发者后台核对下列设置、长连接模式和发布状态。

**绑定已有应用：** 在[飞书开发者后台](https://open.feishu.cn/app)创建企业自建应用，或打开已有应用。开启机器人能力，在「事件与回调」中选择**使用长连接接收事件**，配置下列内容并发布应用版本：

| 类型 | 标识 |
| --- | --- |
| 应用身份权限 | `im:message:send_as_bot`、`im:message.p2p_msg:readonly` |
| 接收消息事件 | `im.message.receive_v1` |
| 卡片回调 | `card.action.trigger` |

选择“绑定已有应用”，只填写 App ID、App Secret，点击“保存并连接”。Lark 国际版可在[高级配置](docs/configuration.zh-CN.md)中设置 `apiOrigin`。已保存密钥不会返回浏览器；同一个 App ID 的密钥输入框留空会保留原值。

两种方式均无需用户 OAuth 登录或公网回调服务器。

### 3. 授权账号并发送第一个任务

**「已连接」表示机器人连接就绪；自己的飞书账号还需出现在「已授权用户」中，才能启动任务。**

1. 等待状态变为「已连接」。如果扫码后已经授权了自己的账号，可跳过配对。
2. 否则，从配置页复制完整的 `/dsh pair …` 指令，**用自己的飞书账号私聊机器人**并发送。尚无授权用户时，保存应用后会自动展示配对码；需要新码时点击「生成授权配对码」。配对码十分钟有效，仅可用一次。
3. 收到机器人配对成功的回复后，先发送 `/dsh status` 查看目录，再发送「列出当前工作目录下的文件」等任务。

默认工作目录为 `~/dsh-workspaces/feishu-im`，会自动创建，配置时无需填写。要处理已有项目，可先在机器人私聊中发送 `/dsh cd /Users/you/projects/my-project`，将示例路径换成已存在的项目目录，再发送任务。更多任务和目录指令见[使用](#使用)。

同一应用的已有授权会保留，更换应用默认清空授权；同一页面可生成新的配对码添加用户。只有明确授权用户的私聊能够启动任务。

## 使用

```text
检查这个项目的测试失败原因
/dsh status
/dsh stop
/dsh new
/dsh cd /Users/you/projects/my-project
/dsh archive
/dsh help
```

任务完成或停止后仍保留在 dsh 的「未分组」列表，普通消息继续当前任务。`/dsh new` 为下一条消息准备新任务，旧任务继续保留；`/dsh archive` 停止并归档当前任务，清空未执行队列；下一条消息会开始新任务。`/dsh cd 路径` 切换当前私聊的目录并准备新任务，支持绝对路径、相对路径及 `~`，路径中的空格无需引号。目标目录须已存在、可读写且位于 profile 之外。运行中请先 `/dsh stop`，等待停止后再新建或切换目录。`/dsh status` 显示当前状态、队列和目录。

新任务使用当前 dsh 默认模型和 Agent preset。已有任务保留原 preset；聊天绑定和目录在重启后恢复。配置中的 `cwd` 是新私聊的默认目录，已绑定的聊天通过 `/dsh cd` 修改。不同应用和用户相互隔离。标题、列表、链接、表格和代码使用飞书原生 Markdown 富文本呈现；长代码块分段后保留语言和围栏。

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
