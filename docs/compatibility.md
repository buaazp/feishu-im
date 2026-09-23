# Compatibility

| Component | Supported / validated version |
| --- | --- |
| dsh / Harness | Published `0.1.7-alpha.2` |
| Cordis | `4.0.4` |
| Node.js | Supported: `^22.19.0` or `>=24.0.0`; local validation: `26.7.0` |
| Feishu SDK | `@larksuiteoapi/node-sdk@1.74.0` |
| pnpm | Profile installation tested with `12.5.1` |
| Application | Enterprise self-built Feishu or Lark bot, long connection |
| Messages | Authorized private human text; interactive card callbacks |

There is no lark-cli runtime, executable or authentication dependency. QR app creation directly follows the official registration API implemented by SDK 1.74.0, with cancellable HTTP; tenant policy and platform rollout determine whether it is available and whether extra permissions/callbacks are prefilled. Manual App ID / App Secret setup remains available.

The bundle is additive and supports the dsh Web profile. Its browser entry uses published client bundle/slot contracts. Configuration routes use authenticated Connection Fetch registration, sharing dsh's origin and session checks. The `/api` RPC interceptor itself has a single owner in this dsh version, so the plugin contributes exact routes instead of replacing that owner.

Harness APIs are pre-stable. Upgrade their pinned versions together and rerun Agent, browser, lifecycle, and packed-profile tests. Never use sibling workspace links or replacement runtime APIs.

pnpm may request a build-script decision for the SDK's transitive `protobufjs` dependency. Its optional script reports dependent version ranges. Installation and runtime are verified with that script explicitly denied in the isolated test profile.
