# Contributing

Use Node.js 22.19+ (22.x) or 24+, npm, and pnpm 10+. No live Feishu account or model key is needed for automated tests.

```sh
npm ci
npm run check
npm run test:integration
npm run package:check
```

`check` runs strict TypeScript, lint, and unit coverage. Every source file currently has a 100% statement, branch, function, and line threshold. Test meaningful failures at process, file, wire, and lifecycle interfaces; do not add tests that merely mirror an implementation. Integration packs the actual artifact, installs it through dsh into a temporary profile, exercises the authenticated configuration API, writes a file through the real Agent tool, restarts, and checks history and duplicate suppression.

Keep Harness dependencies on the tested published version. Do not import a sibling source checkout or add an alternate Agent entry point. Read [architecture](docs/architecture.md), [compatibility](docs/compatibility.md), and [AGENTS.md](AGENTS.md). Tests own temporary paths, ports, and process cleanup; restore test-local fake timers, and never send real Feishu messages in CI.

For a pull request, explain the user-visible change and relevant verification. Update Chinese and English user guides, CLI help, and the configuration table with behavior changes. Keep secrets, app ids, human ids, chat logs, and local paths out of fixtures. Replace real identifiers with clearly synthetic examples.

Bug reports should include the plugin, dsh, Node, pnpm, Feishu SDK and OS versions; a minimal reproduction; and redacted logs. Use the GitHub issue template. Follow [SECURITY.md](SECURITY.md) for sensitive reports. Publication instructions are in the [release guide](docs/releasing.md).

欢迎中文 issue 和 PR。修改用户行为时同步中英文使用文档；测试不需要真实飞书账号或模型密钥。请提供版本、最小复现和脱敏日志，敏感漏洞请勿公开提交。
