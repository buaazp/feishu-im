# Compatibility

| Component | Supported / validated version |
| --- | --- |
| dsh / Harness | Minimum `0.1.5-rc.2`; tested with `0.1.5-rc.2`, `0.1.7-alpha.2` and `0.2.0-rc.2` |
| Cordis / loader / Schemastery | Minimum `4.0.2` / `1.0.3` / `3.18.2` |
| Node.js | Supported: `^22.19.0` or `>=24.0.0`; local validation: `26.7.0` |
| Feishu SDK | `@larksuiteoapi/node-sdk@1.74.0` |
| pnpm | Profile installation tested with `12.5.1` |
| Application | Enterprise self-built Feishu or Lark bot, long connection |
| Messages | Authorized private human text; interactive card callbacks; Markdown rich-text replies |

There is no lark-cli runtime, executable or authentication dependency. QR app creation directly follows the official registration API implemented by SDK 1.74.0, with cancellable HTTP; tenant policy and platform rollout determine whether it is available and whether extra permissions/callbacks are prefilled. Manual App ID / App Secret setup remains available.

The bundle is additive and supports the dsh Web profile and the corresponding runtime in DSH Desktop. Its browser entry uses published client bundle/slot contracts: a collapsible `settings.plugin.item` card on older dsh and one `plugins.row.config` entry on 0.1.7 and 0.2.0. It does not register a duplicate bundle-level form. Configuration routes use authenticated Connection Fetch registration, sharing dsh's origin and session checks. The `/api` RPC interceptor itself has a single owner, so the plugin contributes exact routes instead of replacing that owner.

Task routing and admission records use the published `dsh-storage-domain` service (`storageDomain.open`); explicit archives use `dsh-workspace` (`workspaceRegistry.archiveSession`). These public contracts are available on all tested hosts. Completed or stopped tasks stay in Ungrouped, and `/dsh new`, `/dsh archive` and `/dsh cd` have the same behavior on each. Persist the `feishu_im` domain, Workspace state and Session storage together.

Harness peer ranges are `^0.1.5-rc.2 || ^0.1.6-alpha.1 || ^0.1.7-alpha.1 || 0.2.0-rc.2`; the separate alternatives admit npm prereleases correctly. The new 0.2 support is limited to the tested exact release. New preset-registry and plugin-manager packages are not required on older hosts. All development Harness dependencies, including runtime peers, are pinned to `0.2.0-rc.2`; CI also installs isolated `0.1.5-rc.2` and `0.1.7-alpha.2` hosts. Harness APIs are pre-stable: rerun Agent, browser, lifecycle and packed-profile tests when updating the host. Never use sibling workspace links or replacement runtime APIs.

Plugin `0.2.3` correctly fails the 0.2 host's peer-compatibility check because it did not declare that runtime. Install `0.2.4` instead. The tested combination passes normal installation without `allow-version` exemptions. Desktop can manage a different runtime from the terminal's global `dsh`; use the version reported by Desktop and install into its active profile.

pnpm may request a build-script decision for the SDK's transitive `protobufjs` dependency. Its optional script reports dependent version ranges. Installation and runtime are verified with that script explicitly denied in the isolated test profile.

Earlier-version audit: `0.1.1-rc.2` lacks the required disposable Session observations, exact authenticated Fetch routes and Agent-scoped questions. `0.1.2-rc.1` has these APIs but its fresh published Web installation fails during HMR startup with current transitive dependencies; it is not declared supported. The plugin does not alter the host to bypass that failure.

中文：最低支持 dsh `0.1.5-rc.2`，同时验证 `0.1.7-alpha.2` 和 Desktop 使用的 `0.2.0-rc.2`。旧版使用展开卡片，新版使用单一行配置入口；公开的聊天存储、任务准入和原生归档接口在三个测试版本中保持兼容。0.2.4 对 `0.2.0-rc.2` 声明精确支持，不放宽到未测试的 0.2 版本，也不要求用户开启版本豁免。开发依赖统一固定到 `0.2.0-rc.2`，CI 保留两个旧版本的真实安装测试。Desktop 内置或管理的运行时可能与终端 CLI 不同，请以 Desktop 报告的版本为准。更早的 `0.1.2-rc.1` 有必要接口，但全新 Web 启动存在上游 HMR 兼容问题，因此不声明支持。
