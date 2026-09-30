# Operations

[中文](operations.zh-CN.md)

Install into a dsh Web profile, restart it, then open **Plugins → dsh-feishu-im** and the **feishu-im** row's configuration control. On older dsh, expand **Settings → Plugins → Feishu IM**. Choose QR creation or bind an existing app with App ID / App Secret. The default task directory `~/dsh-workspaces/feishu-im` is created automatically. Keep dsh running to receive long-connection events. The [systemd example](../examples/feishu-im.service) runs the Web profile; adjust user, binary and workspace paths.

| Symptom | Check |
| --- | --- |
| Plugin page absent | Install the built tarball into the profile you actually launch, enable the bundle and restart dsh. |
| `ERR_PNPM_GIT_RESOLVE_FAILED` for a tarball | Use the tarball’s absolute path. dsh runs pnpm from the profile directory; a bare `artifacts/file.tgz` is ambiguous. |
| pnpm blocks installation | Decide the `protobufjs` script in the Plugins page and retry, or explicitly deny its optional version-check script in profile `pnpm-workspace.yaml`. |
| Desktop rejects the plugin as incompatible with dsh `0.2.0-rc.2` | Install plugin `0.2.4` or later with explicit support for that runtime. Version `0.2.3` only declared 0.1.x support. Check Desktop's runtime version, which can differ from the terminal CLI; no exemption is needed for the tested combination. |
| CLI says the `desktop` profile is managed exclusively by Electron | Install the local tarball through Desktop's plugin manager. The external CLI deliberately cannot modify that profile. |
| QR creation fails | Organization permissions or platform rollout may block registration. Retry or configure an existing enterprise app. |
| Credentials fail | Check App ID, App Secret and enabled bot capability. International Lark uses `apiOrigin: https://open.larksuite.com` in advanced configuration. |
| Connected but silent | Publish the app, make it available to your user, subscribe to `im.message.receive_v1`, use private text, and pair the sender. |
| No card response | Subscribe to `card.action.trigger` using long connection; only the initiating user can answer the original, unexpired card. |
| Pairing fails | Use the code automatically shown after saving with no authorized users, or generate a new one on the page. Send it in a private bot chat within ten minutes; another settings edit may invalidate the old revision. |
| Task remains pending | Read the progress/decision card; `/dsh status` reports the queue, `/dsh stop` cancels it. |
| Continue a completed task | Tasks stay in Ungrouped. Send ordinary text to continue, `/dsh new` to start fresh or `/dsh archive` to archive explicitly. |
| Change project directory | Send `/dsh cd PATH`. The directory must exist, be readable/writable and remain outside the profile. Stop running work and wait for it to finish first. |
| Markdown looks wrong | Confirm the new build is installed; replies use rich-text `post` content. Use a current Feishu client; very large tables may split across messages. |
| Model or tools fail | Verify dsh's default model credentials and current Agent preset independently in Web. |
| Existing Session refused | Restore its original directory/preset composition, or use `/dsh new` to start a fresh task. |
| Final reply fails | Side effects may already be committed. Check dsh's Session history before explicitly requesting more work. |

`feishu-im doctor --json`, invoked through `dsh plugin --profile web exec`, checks configuration, workspace access and direct bot authentication without sending messages. It cannot prove event subscriptions or tenant app publication; verify those with a human private message.

Stopping dsh or replacing account settings cancels and awaits owned work. Old cards never authorize new tasks after restart. Preserve the `feishu_im` storage domain, Workspace state and Session storage together to recover chat directories, current tasks, archives and admission records. The plugin does not guarantee event backfill or durable message delivery while Feishu is disconnected.

Only the dsh-authenticated operator can change configuration or see a pairing code. Do not share dsh login URLs, profile files or App Secrets. Treat an authorized bot user as someone who can use the tools permitted by the dsh deployment. Rotate compromised credentials in the developer console and save the new secret on the page.

If installation succeeds with only Harness `missing peer` warnings, verify the host version against the compatibility matrix. dsh supplies these external modules at runtime, and profiles use `autoInstallPeers: false`. Do not install a second Harness dependency tree just to silence the warning.
