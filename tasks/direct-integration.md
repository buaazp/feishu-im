# Direct Feishu integration

## Objective

Replace lark-cli with the official Feishu SDK and OpenAPI. Install into a dsh Web profile, restart, then use the Feishu IM settings page to scan a registration QR or enter App ID / App Secret. Private conversations receive task milestones and interactive approvals/questions.

## Architecture and sources

- Keep published Harness packages at 0.1.7-alpha.2. Compose an additive plugin beside the Web runner; create/resume agents using the published preset registry when present.
- Use `@larksuiteoapi/node-sdk@1.74.0` for WebSocket handling and `registerApp`. Direct HTTP requests own cancellation, timeouts, token renewal and deterministic reply UUIDs. Source: https://github.com/larksuite/node-sdk/blob/main/README.md
- Register the browser page through `dsh.client` and settings/plugin slots. Use authenticated `connection.rpc` and revisioned Settings; secrets are role-marked and never returned. Sources: published READMEs/types of dsh-client-connection, dsh-client-ui-settings and dsh-settings.
- A QR scan explicitly binds the scanning human. Manual credentials require explicit allowed users or a short-lived pairing code shown only in the authenticated settings page. Private chats only; no open access or secret import from lark-cli.
- Subscribe to committed Session events for concise assistant text and tool/turn milestones. Do not expose raw reasoning blocks or dump tool payloads. Serialize and throttle progress-card updates; final delivery failure never reruns task side effects.
- Answer Agent-scoped `approval/request` and `user-questions/request` waterfalls with one-shot cards. Bind callbacks to app, conversation, sender, card and expiring random request token; cancellation/restart invalidate decisions. Sources: published dsh-user-approval and dsh-user-questions contracts.

## Increment order and acceptance

1. Direct transport: token renewal, bounded parsing, replies/updates and real SDK lifecycle. Test with owned HTTP/WebSocket servers, including abort/failure.
2. Runtime migration: additive bundle, live account configuration, preset-aware agents and durable admission/restart. Remove CLI transport, discovery and flags; run lifecycle/driver tests.
3. Task feedback: ordered milestone cards and final result; one-shot approvals and structured questions including multiselect/free text. Test spoofing, expiry, duplicate clicks, cancellation and delivery failure.
4. Configuration: authenticated status/configuration RPC, official QR registration, explicit pairing and settings page with secret-preserving saves. Test fake external endpoints and inspect in a real browser.
5. Delivery: bilingual guides/migration, metadata/help, packed installation in real dsh Web with fake Feishu/model. Run check, build, test:integration and package:check.

## Boundaries

No npm publication, remote push, real messages or modifications to existing user profiles during verification. App availability and tenant administrator policies remain controlled by Feishu. Existing conversation ids require an explicit legacy namespace for continuity; users supply credentials again.
