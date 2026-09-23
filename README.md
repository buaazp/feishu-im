# Feishu IM for dsh

[简体中文](README.zh-CN.md) · [Configuration](docs/configuration.md) · [Operations](docs/operations.md)

Run dsh tasks in private Feishu bot chats. The plugin calls Feishu OpenAPI directly and receives long-connection events through the official Node SDK. **No lark-cli installation is required.**

- Open **Plugins → dsh-feishu-im** in dsh to scan a registration QR or enter App ID / App Secret.
- Authorize your Feishu account with a single-use pairing code. Only explicitly authorized private text messages start tasks.
- Conversations retain history, serialize tasks and isolate users.
- Progress cards update task stages, tool status and public assistant explanations; a separate text reply delivers the result. Raw reasoning blocks and tool outputs are not forwarded.
- Interactive cards collect approvals, single/multiple choices and custom answers.

## Install

Use Node.js `^22.19.0` or `>=24.0.0` and the tested published `@deepseek-ai/dsh@0.1.7-alpha.2`. Harness APIs are pre-stable; use this exact version.

Build an installable package from this repository:

```sh
npm ci
npm run build
mkdir -p artifacts
npm pack --pack-destination artifacts
dsh plugin --profile web add "$PWD/artifacts/dsh-feishu-im-0.2.1.tgz"
```

Use the absolute path: dsh runs pnpm inside the profile directory. A bare `artifacts/package.tgz` can be interpreted as a GitHub repository and fail with `ERR_PNPM_GIT_RESOLVE_FAILED`. Changing GitHub authentication does not fix that path.

pnpm 11+ may require a decision about the `protobufjs` install script. The dsh Plugins page offers **Allow these scripts and retry**. That script only checks dependent version ranges. Alternatively, explicitly set `allowBuilds.protobufjs: false` in this profile's `pnpm-workspace.yaml` and retry; the plugin is tested with that script denied. Preserve other workspace settings.

Restart `dsh --profile web`, open **Plugins** in the sidebar, and select **dsh-feishu-im**. The channel runs beside the existing Web application runner.

## Connect a bot

Enter an absolute task workspace outside the dsh profile directory that stores configuration and credentials.

**QR:** Select **Create a bot with QR → Generate QR code**, scan with Feishu and confirm on your phone. This official registration flow is subject to your organization's app creation permissions and administrator approval. Credentials are saved on success. When Feishu returns the scanner's open_id, only that user is authorized; otherwise authorize with a pairing code.

**Existing application:** Create an enterprise self-built app in the [Feishu developer console](https://open.feishu.cn/app), enable its bot capability, select **long connection** under Events & Callbacks, configure the following and publish an app version:

| Type | Identifiers |
| --- | --- |
| App-identity permissions | `im:message:send_as_bot`, `im:message.p2p_msg:readonly` |
| Message event | `im.message.receive_v1` |
| Card callback | `card.action.trigger` |

Enter App ID and App Secret, then **Save and connect**. Choose the Lark region for international Lark applications. Saved secrets never return to the browser; a blank secret keeps the existing value only for the same App ID.

Once connected, generate a pairing code and send the displayed `/dsh pair …` command to the bot from your own private chat. Codes expire after ten minutes and work once. Alternatively, enter explicit human open_ids in the authorized-users field. After pairing, send a task.

Feishu controls availability of QR permission/callback prefilling. If messages or card actions do not arrive after registration, verify the listed settings, long-connection mode and publication status in the developer console. No user OAuth login or public callback server is required.

## Use

```text
Find why this project's tests fail
/dsh status
/dsh stop
/dsh help
```

New conversations use dsh's current default model and Agent preset. Resumed conversations retain their original preset. Changing the application or workspace gives the conversation a new identity.

Only the task's initiating user can answer its card in the original private chat. **Allow once** grants just that action. Rejection, cancellation, expiry and restart never grant permission; dsh's `never` approval policy still applies. Requests that cannot be displayed completely fail closed.

A failed reply never reruns task side effects. Feishu controls event delivery during disconnection; the plugin cannot guarantee complete offline replay.

## Upgrade from 0.1

Version 0.2 removes `command`, `profile`, `maxRecordBytes` and `graceMs`. It never reads or copies lark-cli credentials.

Install into an existing Web profile and configure credentials again. Remove an old `headless-runner` override only if it belongs to `dsh-feishu-im`; preserve other runners. New settings live under `id: feishu-im`, `config.account`.

Continuing old history requires the original Session store, workspace and an explicit `legacyNamespace` matching the old CLI profile name. Preset-free legacy sessions cannot resume under a Web preset; retain their original composition or start fresh. See [configuration](docs/configuration.md).

## Develop and verify

```sh
npm run check
npm run build
npm run test:integration
npm run package:check
```

Integration tests install the tarball into an isolated real dsh Web profile and use local fake Feishu HTTP/WebSocket endpoints and a fake model. They cover configuration, pairing, tool execution and restart deduplication without sending real messages. [Architecture](docs/architecture.md) · [Compatibility](docs/compatibility.md) · [Security](SECURITY.md)
