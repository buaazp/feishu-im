# Feishu IM for dsh

[简体中文](README.zh-CN.md) · [Configuration](docs/configuration.md) · [Troubleshooting](docs/operations.md) · [Architecture](docs/architecture.md)

Run tasks on your machine by messaging your Feishu bot. This independent dsh plugin reuses an existing **lark-cli application profile**: no copied app secret, webhook server, or separate Agent runtime.

```text
You → Feishu private chat → lark-cli → dsh Agent → files and tools
You ← final answer        ← bot reply ← saved Session
```

- Explicit sender allowlist; private text messages only.
- Persistent conversation history, ordered follow-ups, and duplicate admission suppression.
- `/dsh status`, `/dsh stop`, and `/dsh help`; Chinese or English control messages.
- Guided configuration and read-only diagnostics through `feishu-im setup` and `doctor`.
- Tested as a packed plugin installed into the published dsh runtime.

## Quick start

### 1. Prepare the tools

Use Node.js **22.19+ in the 22.x line, or 24+**, pnpm **10+**, and [lark-cli](https://github.com/larksuite/cli) **1.0.78** or a compatible newer version. Install the exact supported dsh version; its npm `latest` tag may point to an older incompatible release.

```sh
npm install -g @deepseek-ai/dsh@0.1.7-alpha.2
node --version
pnpm --version
lark-cli --version
```

Keep an existing compatible dsh installation. For a different dsh version, use an isolated installation rather than replacing a shared runtime. See [compatibility](docs/compatibility.md).

In the Feishu developer console, enable the application's bot, make it available to your account, select the long-connection event delivery mode, and subscribe to `im.message.receive_v1`. Enable the permissions required to receive private messages and reply as the bot, including `im:message.p2p_msg:readonly` and `im:message:send_as_bot`, then publish the app changes. Follow lark-cli's reported missing scopes if your app needs additional permissions.

If the app is already configured in lark-cli, reuse it. Otherwise run `lark-cli config init`. Check the configured profiles and the chosen bot:

```sh
lark-cli profile list
lark-cli --profile YOUR_APP_PROFILE auth status --json --verify
```

The bot must be available and verified. An expired **user** token is not a reason to log in again for this plugin. Find your human `ou_...` open_id for this application in `identities.user.openId`, or resolve it with lark-cli's contact tools. Do not use the bot's open_id.

### 2. Install the plugin

This source release is installed from a tarball. The package is not yet published to npm. From this repository checkout:

```sh
npm ci
npm pack
```

Install the resulting file into a **new dedicated profile**. Replace the path with the absolute path to your tarball; `feishu` is an arbitrary profile name.

```sh
dsh plugin --profile feishu add /absolute/path/dsh-feishu-im-0.1.0.tgz
```

Do not install this bundle into `headless`, `web`, or another profile with an application runner.

### 3. Configure once

Create a directory where tasks should run, then start the interactive guide:

```sh
mkdir -p "$HOME/feishu-work"
dsh plugin --profile feishu exec feishu-im setup
```

The guide selects an app, asks which humans to authorize, and asks for the task directory. For repeatable or noninteractive setup:

```sh
dsh plugin --profile feishu exec feishu-im setup \
  --lark-profile YOUR_APP_PROFILE \
  --allow-user ou_YOUR_HUMAN_OPEN_ID \
  --workspace "$HOME/feishu-work" \
  --locale en

dsh plugin --profile feishu exec feishu-im doctor
```

Setup stores references and settings in the profile's `cordis.patch.yml`; credentials stay in lark-cli. `doctor` checks configuration, directory access, and bot identity. It does not contact the model or open an event connection.

### 4. Launch and send a task

Configure the dsh model credential through your existing dsh credential store or the `DEEPSEEK_API_KEY` environment variable. The base profile selects `deepseek-official / deepseek-flash`; [configuration](docs/configuration.md) explains changing the model.

Launch **from the task directory**, so dsh's workspace permission root matches the configured directory:

```sh
cd "$HOME/feishu-work"
dsh --profile feishu
```

Wait for `feishu-im: ready for private messages`. Send this to the bot in a private chat:

> Create `hello-feishu.txt` in the current directory with the content `HELLO_FEISHU`, then tell me its filename.

The bot acknowledges the task, dsh executes it, and the bot replies with the final answer. Send a follow-up to continue the same history. Stop the process with Ctrl+C. Run only one task-driving listener for the app.

## Everyday use

| Send to the bot | Result |
| --- | --- |
| Any nonempty text | Start or continue a task |
| `/dsh status` | Current activity and waiting message count |
| `/dsh stop` | Cancel current work and clear waiting messages |
| `/dsh help` | List commands |

The `/dsh` prefix is reserved: `/dsh` and unknown `/dsh ...` commands show help. Other text, including unrelated slash commands, is a task. Different authorized senders have separate histories but **share the same task directory and OS account**. The allowlist is not filesystem isolation. Review the profile's tools and permissions before adding users.

The release supports final plain-text replies. Groups, files, images, interactive approval cards, streaming progress, and offline message replay are not implemented. Interactive tool approvals have no Feishu UI; tasks needing them may fail or wait until stopped or timed out. Keep appropriate dsh permission rules; do not disable them to work around missing UI.

For model-side Feishu document/calendar skills, install the upstream skills separately with `npx skills add larksuite/cli -g -y` and make them available to dsh's skill loader. The IM driver itself directly uses the public CLI commands documented by those skills. Additional skills may require their own user authorization.

## Guides and development

- [Configuration reference](docs/configuration.md): settings, model selection, and advanced overrides.
- [Operations and troubleshooting](docs/operations.md): restarts, upgrades, logs, recovery, and uninstall.
- [Architecture](docs/architecture.md) and [compatibility](docs/compatibility.md): design and supported APIs.
- [Contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), [release guide](docs/releasing.md), and [changelog](CHANGELOG.md).

```sh
npm ci
npm run check
npm run test:integration
npm run package:check
```

Automated tests replace only external model and Feishu endpoints. They never send real messages. See [validation](docs/validation.md) for recorded evidence and the manual live-check procedure.

MIT licensed. Derived from the DeepSeek Harness Lark IM driver; see [NOTICE](NOTICE). This project is independent of DeepSeek and Feishu/Lark.
