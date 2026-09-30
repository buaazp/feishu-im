# Changelog

## 0.2.4 (unreleased)

- Support the published dsh `0.2.0-rc.2` used by Desktop with an exact peer-version alternative. The normal plugin installer now accepts this tested combination without compatibility exemptions.
- Pin the complete development Harness graph to `0.2.0-rc.2`, retain packed-install CI coverage for `0.1.5-rc.2` and `0.1.7-alpha.2`, and clarify Desktop versus terminal runtime versions in both user guides.
- 修复 Desktop 的 dsh `0.2.0-rc.2` 拒绝安装的问题；明确声明支持已验证的版本，无需开启版本豁免。开发依赖统一升级，并保留旧版安装回归测试。

## 0.2.3 (unreleased)

- Simplify connection to QR creation or App ID / App Secret binding, with the automatic `~/dsh-workspaces/feishu-im` default and one-use pairing code. Preserve same-app authorization and clear it by default when replacing an app; make CLI `--workspace` optional. Use the native plugin row configuration entry and a collapsible legacy settings card.
- Keep completed/stopped Feishu tasks in Ungrouped; persist chat routing and add `/dsh new`, `/dsh archive`, and `/dsh cd PATH`, preserving admission deduplication across switches and restarts through the published storage-domain and Workspace APIs on both supported host generations.
- Send native Feishu Markdown posts with Unicode-safe byte bounds and code-fence continuation.
- 配置仅保留「扫码创建机器人」和「绑定已有应用」，绑定只需 App ID / App Secret；默认目录自动创建，页面保存后在无授权时自动提供一次性配对码，CLI 的 `--workspace` 可省略。
- 完成或停止的任务保留在「未分组」，支持 `/dsh new`、`/dsh archive`、`/dsh cd 路径`；通过两种宿主均支持的公开 API 持久保存聊天路由、归档与跨任务去重记录。
- 回复使用飞书原生 Markdown 富文本，按字节限制安全分段并延续代码围栏。

## 0.2.2

- Lower the minimum supported dsh to `0.1.5-rc.2`, Cordis to `4.0.2`, loader to `1.0.3`, and Schemastery to `3.18.2`. Preserve support for `0.1.7-alpha.2`.
- Adapt the published legacy settings and configuration slots, and remove the requirement for the newer preset-registry package.
- Verify packed installation, pairing, real preset tools, interactive answers, cancellation and restart deduplication on both host generations. Clarify legacy Web settings precedence in CLI help and both user guides.

## 0.2.1

- Use an absolute tarball path in the copyable installation command to avoid pnpm treating it as a GitHub repository.
- Keep management commands independent of Harness runtime resolution. Preserve the profile's default peer and linker settings in packed-installation tests.
- 修复本地安装包路径歧义，以及默认 pnpm 配置下管理命令错误加载 Harness 模块的问题。

## 0.2.0

- Replace lark-cli with direct Feishu OpenAPI and the official SDK long connection.
- Add the dsh Plugins configuration page with official QR registration, manual credentials, live updates and explicit one-use pairing.
- Compose beside dsh Web and mount the original Agent preset when resuming history.
- Show task milestones in updated cards and collect approvals and structured answers through sender-bound interactive cards.
- Preserve durable message deduplication, bounded queues, cancellation and awaited shutdown.
- Move configuration to `config.account`; remove command/profile transport options. Existing secrets are never imported automatically.

## 0.1.0

- Initial standalone plugin with lark-cli bot transport, dedicated profile setup, private-chat authorization and durable conversation history.
