# Compatibility

| Component | Supported / validated version |
| --- | --- |
| dsh / Harness | Minimum `0.1.5-rc.2`; tested with `0.1.5-rc.2` and `0.1.7-alpha.2` |
| Cordis / loader / Schemastery | Minimum `4.0.2` / `1.0.3` / `3.18.2` |
| Node.js | Supported: `^22.19.0` or `>=24.0.0`; local validation: `26.7.0` |
| Feishu SDK | `@larksuiteoapi/node-sdk@1.74.0` |
| pnpm | Profile installation tested with `12.5.1` |
| Application | Enterprise self-built Feishu or Lark bot, long connection |
| Messages | Authorized private human text; interactive card callbacks |

There is no lark-cli runtime, executable or authentication dependency. QR app creation directly follows the official registration API implemented by SDK 1.74.0, with cancellable HTTP; tenant policy and platform rollout determine whether it is available and whether extra permissions/callbacks are prefilled. Manual App ID / App Secret setup remains available.

The bundle is additive and supports the dsh Web profile. Its browser entry uses published client bundle/slot contracts. Configuration routes use authenticated Connection Fetch registration, sharing dsh's origin and session checks. The `/api` RPC interceptor itself has a single owner in this dsh version, so the plugin contributes exact routes instead of replacing that owner.

Harness peer ranges are `^0.1.5-rc.2 || ^0.1.6-alpha.1 || ^0.1.7-alpha.1`; the separate alternatives admit npm prereleases correctly. New preset-registry and plugin-manager packages are not required on older hosts. Development dependencies remain pinned to the tested 0.1.7 release. Harness APIs are pre-stable: rerun Agent, browser, lifecycle and packed-profile tests when updating the host. Never use sibling workspace links or replacement runtime APIs.

pnpm may request a build-script decision for the SDK's transitive `protobufjs` dependency. Its optional script reports dependent version ranges. Installation and runtime are verified with that script explicitly denied in the isolated test profile.

Earlier-version audit: `0.1.1-rc.2` lacks the required disposable Session observations, exact authenticated Fetch routes and Agent-scoped questions. `0.1.2-rc.1` has these APIs but its fresh published Web installation fails during HMR startup with current transitive dependencies; it is not declared supported. The plugin does not alter the host to bypass that failure.

中文：最低支持 dsh `0.1.5-rc.2`，无需升级到 `0.1.7-alpha.2`；两种配置 API 和页面入口均已适配。Cordis、loader、Schemastery 的最低版本分别降为 `4.0.2`、`1.0.3`、`3.18.2`。更早的 `0.1.2-rc.1` 虽有必要接口，但全新安装的 Web 启动存在上游 HMR 兼容问题，因此不将仅有接口的版本声明为可用版本。
