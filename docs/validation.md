# Validation

Automated checks use published Harness packages. External Feishu and model services are replaced by test-owned endpoints; no real bot messages are sent.

- Unit tests cover bounded API parsing, token sharing/renewal, SDK connection lifecycle, account reconfiguration, explicit pairing, QR outcomes, durable admission, task cancellation, message failures and card identity checks.
- Published Agent approval and question services exercise real scoped routing, including the `never` policy.
- Browser-page tests cover configuration form actions, polling, redacted secret handling and teardown.
- Packed integration installs the artifact into an isolated dsh Web profile, checks authenticated settings routes, configures the bot, pairs a human, runs real preset tools and verifies restart deduplication.

Run `npm run check`, `npm run build`, `npm run test:integration` and `npm run package:check`. Tests own their temporary directories, ports and subprocess cleanup. Package checks verify the shipping file set, documentation links and all documented settings.

Live QR registration, tenant administration policies and actual Feishu chat rendering require an authorized Feishu application and human account. They are not exercised by automated tests. Local fixtures verify protocol contracts without claiming a live-tenant acceptance result.

## Local verification — 2026-09-23

- macOS, Node 26.7.0, pnpm 12.5.1; published dsh 0.1.7-alpha.2.
- `npm run check`: 107 tests passed; every source file has 100% statements, branches, functions and lines. TypeScript and lint passed.
- `npm run test:integration`: one packed-installation test passed, including real preset tool execution, pairing, account reconfiguration, restart and duplicate suppression.
- `npm run package:check`: build and publint passed without warnings; shipping files, links and configuration documentation validated.
- Real browser: the installed bundle appears in dsh Plugins and renders its Feishu configuration page with QR and existing-app entry points. Form submissions and request teardown are also covered by component tests.
- Production dependency audit reported no known advisories. The full development installation retains five moderate advisories in the pinned dsh office-document dependency chain; no forced Harness upgrade was applied.

The existing user's profiles were not modified. This verification did not send real Feishu messages, create a real Feishu application, publish npm, or push the feature branch.

中文：本地已通过 107 项测试、100% 源码覆盖率、真实 dsh Web 安装/配对/工具执行/重启去重集成测试及无警告打包检查；浏览器确认配置页可加载。没有修改现有用户 profile，也没有进行真实飞书扫码、发消息或 npm 发布。

## Installation regression — 0.2.1

The packed-install test now preserves the profile's generated `nodeLinker: hoisted` and `autoInstallPeers: false`, changing only the optional `protobufjs` build decision. This exposed and fixed a management-CLI import of the Harness brand helper through reply encoding. CLI help and the complete Web configuration/pairing/preset/restart flow pass with the actual default policy. Local tarball installation uses an absolute path; a bare `artifacts/file.tgz` reproduces pnpm's Git resolution error.

中文：安装回归测试保留真实 profile 的默认依赖策略，只禁用可选脚本；已修复由此暴露的管理命令模块解析问题，并验证绝对路径安装及完整 Web 流程。
