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

## Host compatibility — 0.2.2

- `npm run check`: 111 tests passed with 100% per-file statement, branch, function and line coverage; TypeScript and lint passed.
- Real packed Web flows pass on the existing published dsh 0.1.5-rc.2 installation and on the pinned 0.1.7-alpha.2 development host: authenticated setup, pairing, actual preset file writes, interactive question cards, stop/cancellation, restart/history and duplicate suppression.
- Fresh published-host integration also passed. `FEISHU_TEST_DSH_VERSION=0.1.5-rc.2 npm run test:integration` installs a separate published host in a test-owned temporary directory; CI runs this compatibility check alongside the current host. `FEISHU_TEST_DSH=/absolute/path/to/dsh/lib/bin.js` can verify an existing installation without touching its profiles.
- The local 0.2.2 artifact was installed into the existing user Web profile; `feishu-im --version` and setup help passed, with global dsh retained at 0.1.5-rc.2.
- Legacy and current browser slots are covered by component tests. A fresh visual check of the old host could not run because the browser automation connection was unavailable; the 0.1.7 page was visually checked during 0.2.0 development.
- The candidate 0.1.2-rc.1 has the required API declarations but fails its fresh Web boot with current transitive HMR dependencies. It is excluded from the supported range. No upstream runtime was patched to make a test pass.

中文：0.2.2 将最低已验证版本降至 dsh 0.1.5-rc.2，保留 0.1.7-alpha.2 支持。111 项测试及全部源码覆盖率检查通过；真实安装流程覆盖任务工具、交互卡片回答、取消和重启去重。本轮旧版页面组件测试通过，但浏览器自动化连接不可用，未完成新的旧版页面目视验证。未发送真实飞书消息。
