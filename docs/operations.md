# Operations

[中文](operations.zh-CN.md)

Install into a dsh Web profile, restart it from the task workspace, then configure **Plugins → dsh-feishu-im**. Keep dsh running to receive long-connection events. The [systemd example](../examples/feishu-im.service) runs the Web profile; adjust user, binary and workspace paths.

| Symptom | Check |
| --- | --- |
| Plugin page absent | Install the built tarball into the profile you actually launch, enable the bundle and restart dsh. |
| pnpm blocks installation | Decide the `protobufjs` script in the Plugins page and retry, or explicitly deny its optional version-check script in profile `pnpm-workspace.yaml`. |
| QR creation fails | Organization permissions or platform rollout may block registration. Retry or configure an existing enterprise app. |
| Credentials fail | Check App ID, App Secret, Feishu/Lark region and enabled bot capability. |
| Connected but silent | Publish the app, make it available to your user, subscribe to `im.message.receive_v1`, use private text, and pair the sender. |
| No card response | Subscribe to `card.action.trigger` using long connection; only the initiating user can answer the original, unexpired card. |
| Pairing fails | Refresh the configuration page and generate a new code. Another settings edit may invalidate the old revision. |
| Task remains pending | Read the progress/decision card; `/dsh status` reports the queue, `/dsh stop` cancels it. |
| Model or tools fail | Verify dsh's default model credentials and current Agent preset independently in Web. |
| Existing Session refused | Restore its original workspace/preset composition or start a fresh conversation namespace. |
| Final reply fails | Side effects may already be committed. Check dsh's Session history before explicitly requesting more work. |

`feishu-im doctor --json`, invoked through `dsh plugin --profile web exec`, checks configuration, workspace access and direct bot authentication without sending messages. It cannot prove event subscriptions or tenant app publication; verify those with a human private message.

Stopping dsh or replacing account settings cancels and awaits owned work. Old cards never authorize new tasks after restart. Persist the dsh Session storage to retain deduplication. The plugin does not guarantee event backfill or durable message delivery while Feishu is disconnected.

Only the dsh-authenticated operator can change configuration or see a pairing code. Do not share dsh login URLs, profile files or App Secrets. Treat an authorized bot user as someone who can use the tools permitted by the dsh deployment. Rotate compromised credentials in the developer console and save the new secret on the page.
