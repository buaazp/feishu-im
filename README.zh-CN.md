# Feishu IM for dsh

[English](README.md) · [配置参考](docs/configuration.zh-CN.md) · [运维与排障](docs/operations.zh-CN.md) · [架构设计](docs/architecture.zh-CN.md)

在飞书私聊机器人，驱动本机 dsh 执行任务。这个独立插件复用 **lark-cli 中已有的应用配置**，无需复制应用密钥、部署 webhook 服务或另外运行一套 Agent。

```text
你 → 飞书私聊 → lark-cli → dsh Agent → 文件和工具
你 ← 最终答复 ← 机器人回复 ← 持久化 Session
```

- 明确的用户白名单，只接收私聊文本。
- 持久化对话、多轮追问、顺序执行和重复消息去重。
- `/dsh status`、`/dsh stop`、`/dsh help`；支持中英文控制提示。
- `setup` 配置向导和 `doctor` 只读诊断。
- 使用公开发布的 dsh，通过真实安装包验证安装和运行。

## 快速开始

### 1. 准备环境和机器人

需要 Node.js **22.x 的 22.19 及以上版本，或 24 及以上版本**、pnpm **10+**，以及 [lark-cli](https://github.com/larksuite/cli) **1.0.78** 或兼容的新版本。dsh 必须使用以下已验证版本；npm 的 `latest` 标签可能仍指向不兼容的旧版本。

```sh
npm install -g @deepseek-ai/dsh@0.1.7-alpha.2
node --version
pnpm --version
lark-cli --version
```

已有兼容版本时直接复用。如果机器上其他项目依赖不同版本，请隔离安装，不要覆盖共享运行时。详见[兼容性](docs/compatibility.md)。

在飞书开发者后台启用应用机器人，确保应用对你的账号可用，将事件接收方式配置为长连接，订阅 `im.message.receive_v1`。开通接收私聊和机器人发送消息所需权限，包括 `im:message.p2p_msg:readonly`、`im:message:send_as_bot`，并发布应用变更。如 lark-cli 报告其他缺失权限，以错误中给出的权限和修复提示为准。

已经在 lark-cli 中配置过应用就直接复用；未配置时运行 `lark-cli config init`。检查应用列表和机器人状态：

```sh
lark-cli profile list
lark-cli --profile YOUR_APP_PROFILE auth status --json --verify
```

机器人身份应为可用且验证通过。**用户 OAuth token 过期不影响此插件使用机器人身份**，不需要因此重新登录。白名单使用该应用下你本人的 `ou_...` open_id，可查看 `identities.user.openId`，或通过 lark-cli 通讯录能力查询；不要填写机器人的 open_id。

### 2. 安装插件

当前源码版本使用 tarball 安装，尚未发布到 npm。在本仓库目录执行：

```sh
npm ci
npm pack
```

将生成的安装包添加到一个**新的专用 profile**。替换为安装包的绝对路径；`feishu` 是可自行修改的 profile 名称。

```sh
dsh plugin --profile feishu add /absolute/path/dsh-feishu-im-0.1.0.tgz
```

请勿安装到 `headless`、`web` 或已经包含其他应用启动器的 profile 中。

### 3. 首次配置

创建任务目录，然后运行交互向导：

```sh
mkdir -p "$HOME/feishu-work"
dsh plugin --profile feishu exec feishu-im setup
```

向导会选择应用，要求明确授权的用户，并询问任务目录。脚本或非交互环境使用完整参数：

```sh
dsh plugin --profile feishu exec feishu-im setup \
  --lark-profile YOUR_APP_PROFILE \
  --allow-user ou_YOUR_HUMAN_OPEN_ID \
  --workspace "$HOME/feishu-work" \
  --locale zh-CN

dsh plugin --profile feishu exec feishu-im doctor
```

配置保存在该 profile 的 `cordis.patch.yml`，应用密钥仍由 lark-cli 管理。`doctor` 检查配置、目录读写权限和机器人身份，不调用模型，也不建立事件连接。

### 4. 启动并发送任务

通过已有 dsh 凭据存储或 `DEEPSEEK_API_KEY` 环境变量配置模型凭据。基础 profile 默认选择 `deepseek-official / deepseek-flash`；更换模型见[配置参考](docs/configuration.zh-CN.md)。

**先进入任务目录再启动**，让 dsh 的工作区权限根目录与插件配置一致：

```sh
cd "$HOME/feishu-work"
dsh --profile feishu
```

看到 `feishu-im: ready for private messages` 后，在飞书中私聊机器人：

> 在当前目录创建 hello-feishu.txt，内容为 HELLO_FEISHU，然后告诉我文件名。

机器人先确认开始处理，dsh 执行任务后再发送最终答复。继续发送消息即可沿用历史。终端按 Ctrl+C 停止服务。同一个应用只运行一个任务监听实例。

## 日常使用

| 发给机器人的内容 | 行为 |
| --- | --- |
| 任意非空文本 | 开始或继续任务 |
| `/dsh status` | 查看处理状态和排队数量 |
| `/dsh stop` | 取消当前任务并清空等待队列 |
| `/dsh help` | 查看命令帮助 |

`/dsh` 是保留前缀，单独发送 `/dsh` 或未知 `/dsh ...` 命令会显示帮助；其余文本（包括其他斜杠命令）作为任务。不同授权用户拥有独立会话，但**共享任务目录和本机系统账号**。白名单不是文件系统隔离机制；添加用户前应确认 profile 的工具和权限设置。

当前仅支持最终纯文本回复，暂不支持群聊、附件、图片、交互审批卡片、实时进度和离线消息补拉。需要交互授权的工具没有飞书审批界面，可能失败或等待到停止、超时；应使用合适的 dsh 权限策略，不要为了绕过缺失界面而关闭权限控制。

如果还希望模型操作飞书文档、日历等，可另外执行 `npx skills add larksuite/cli -g -y` 安装官方 skills，并确保 dsh skill loader 能加载它们。IM 驱动本身直接使用这些 skills 文档描述的公开 CLI 命令。额外业务能力可能需要单独的用户授权。

## 更多文档与开发

- [配置参考](docs/configuration.zh-CN.md)：完整参数、模型选择和自定义配置。
- [运维与排障](docs/operations.zh-CN.md)：重启、升级、日志、故障恢复与卸载。
- [架构设计](docs/architecture.zh-CN.md)、[兼容性](docs/compatibility.md)。
- [贡献指南](CONTRIBUTING.md)、[安全报告](SECURITY.md)、[发布流程](docs/releasing.md)、[变更记录](CHANGELOG.md)。

```sh
npm ci
npm run check
npm run test:integration
npm run package:check
```

自动测试仅替换外部模型和飞书端点，不会发送真实消息。[验证说明](docs/validation.md)记录已执行验证及手工私聊检查步骤。

采用 MIT 许可证，代码源自 DeepSeek Harness Lark IM 驱动，见 [NOTICE](NOTICE)。本项目独立维护，不是 DeepSeek 或飞书官方产品。
