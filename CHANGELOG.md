# Changelog

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
