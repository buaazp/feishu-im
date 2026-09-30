# Validation

Automated checks use published Harness packages. External Feishu and model services are replaced by test-owned endpoints; no real bot messages are sent.

- Unit tests cover bounded API parsing, token sharing/renewal, SDK connection lifecycle, account reconfiguration, explicit pairing, QR outcomes, durable admission, task cancellation, message failures and card identity checks.
- Published Agent approval and question services exercise real scoped routing, including the `never` policy.
- Browser-page tests cover configuration form actions, polling, redacted secret handling and teardown.
- Packed integration installs the artifact into an isolated dsh Web profile, checks authenticated settings routes, configures the bot, pairs a human, runs real preset tools and verifies restart deduplication.

Run `npm run check`, `npm run build`, `npm run test:integration` and `npm run package:check`. Tests own their temporary directories, ports and subprocess cleanup. Package checks verify the shipping file set, documentation links and all documented settings.

Live QR registration, tenant administration policies and actual Feishu chat rendering require an authorized Feishu application and human account. They are not exercised by automated tests. Local fixtures verify protocol contracts without claiming a live-tenant acceptance result.

## Plugin configuration UI — 0.2.5, 2026-09-30

- Replaced the component subpage with the published `plugins.bundle.config` slot, following dsh-context. Verified an actual update in DeepSeek Harness Desktop `0.2.0-rc.2`: version 0.2.5 displays configuration between the description and Included components, without a second configure control.
- Compared the legacy Web card beside the built-in Shell, Agent loop, Subagent and Web search cards in an isolated published `0.1.5-rc.2` Web profile. Light and dark themes share the title/description layout, spacing, border, fill and right-side arrow. Expanded controls render correctly.
- The UI regression first failed for the old row-level registration, then passed for the bundle slot, disclosure accessibility and preservation of unsaved input after collapse/reopen. `npm run check` passed all 148 tests with 100% coverage in all four metrics; build, package checks (75 shipping files) and packed integrations on `0.2.0-rc.2` and `0.1.5-rc.2` passed.
- The interactive legacy preview exceeded the integration test's overall time budget during manual inspection; it is not counted as a completed automated regression. The independent run without the preview pause subsequently passed (29 seconds).

中文：已在实际 Desktop 安装 0.2.5，确认配置位于插件介绍与「包含的组件」之间；隔离 Web 的深浅色主题均与内置卡片对齐。148 项测试和覆盖率检查通过；人工预览占用测试时间导致该次运行超时，随后单独重跑的完整旧版安装回归已通过。两个宿主版本的完整安装回归均通过，没有发送真实飞书消息。

## Desktop runtime compatibility — 0.2.4, 2026-09-30

- Reproduced the reported installation rejection using the original 0.2.3 tarball and a fresh official npm `@deepseek-ai/dsh@0.2.0-rc.2` host. No version exemption was granted.
- Updated the peer declarations with exact `0.2.0-rc.2` support. The current runtime source also compiles against its published declarations without API replacements or sibling-checkout imports.
- `npm run check`: 148 tests passed against the complete pinned 0.2.0-rc.2 development graph, with 100% per-file statements, branches, functions and lines. TypeScript and lint passed.
- `npm run test:integration`: the new package passed normal installation, authenticated configuration, explicit pairing, real preset tools, interactive cards, task/directory switching, native archive, stop and restart deduplication on `0.2.0-rc.2`. Separate published-host runs passed on `0.1.5-rc.2` and `0.1.7-alpha.2`.
- The 0.2.0 client slot, Connection, Settings, Agent lifecycle, Session query, storage-domain and Workspace contracts were checked against official published packages. No plugin runtime/client source change was necessary. CI uses the new host by default and retains both old-host installation checks.
- `npm run package:check` passed with 72 shipping files, 19 Markdown documents and no publint warnings. The actual Desktop profile rejects external CLI installation by design; installing the new tarball through the native application remains a user step. The existing Desktop profile was not changed.

中文：已复现 0.2.3 在 Desktop 使用的 dsh `0.2.0-rc.2` 上的版本拒绝，并验证 0.2.4 无需豁免即可正常安装。148 项测试、四项 100% 覆盖率，以及三个 dsh 版本的完整安装运行回归均通过；未发送真实飞书消息。

## Settings, persistent tasks and Markdown — 0.2.3, 2026-09-29

- macOS, Node 26.7.0, npm 11.19.0.
- `npm run check`: 148 tests passed with 100% per-file statements, branches, functions and lines; TypeScript and lint passed.
- Packed installation passed on published dsh 0.1.7-alpha.2 and a freshly installed 0.1.5-rc.2: credentials-only setup, automatic explicit pairing, preset tool execution, history/restart deduplication, new tasks, directory switching, native archive, cancellation and rich `post` replies.
- Lifecycle regressions cover retained idle tasks, legacy admission import before task switches, storage failure/recovery, archive during creation, stop during admission backlog, Web-originated work, and precise reply/decision ownership when Web and Feishu share a task.
- Markdown fixtures cover CommonMark/GFM payloads, JSON byte limits, Unicode, CRLF and code fences spanning chunks. The payload follows the [official Feishu rich-text message contract](https://open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json.md).
- An isolated real dsh 0.1.7 page in Microsoft Edge showed the completed task under Ungrouped and the native plugin configuration entry. The binding form contained only App ID and App Secret. Legacy expansion and current row slots also passed component tests.
- `npm run package:check` passed: 72 shipping files, 19 Markdown documents and publint without warnings. The local 0.2.3 tarball is unpublished; existing user profiles were not changed. No real Feishu messages were sent.

中文：148 项测试及所有源码的四项 100% 覆盖率检查通过；两个已发布 dsh 版本均通过真实安装、任务工具、新建、切换目录、归档与重启测试。真实浏览器确认完成的任务留在「未分组」，配置表单只需 App ID 和 App Secret。飞书 Markdown 由协议测试验证，未宣称完成真实飞书客户端验收；没有修改现有用户 profile。

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
