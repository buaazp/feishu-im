# Configuration

[中文](configuration.zh-CN.md) · [Quick start](../README.md)

The Web page offers only **Create a bot with QR** and **Bind an existing app**; binding asks only for App ID / App Secret. Expand the **Feishu IM** card on older dsh, or open the **feishu-im** row configuration on 0.1.7. The default directory `~/dsh-workspaces/feishu-im` is created automatically, with no directory field to fill in. Region, language and explicit authorization lists are advanced settings below.

The bundle inserts an additive `feishu-im` entry. Its `config.account` is one atomic, live setting. The dsh page verifies credentials before saving. On 0.1.7 it writes the profile with mode `0600`; older dsh uses its SettingsProvider document (default `$DSH_HOME/settings.yaml`), under `feishu-im.account`, overriding profile defaults. Older profiles sharing DSH_HOME share this namespace; use separate DSH_HOME directories for different bots. Keep the profile outside the bot's workspace and out of Git. Blank credentials leave the channel unconfigured without stopping dsh.

```yaml
- id: feishu-im
  config:
    account:
      appId: cli_0123456789abcdef
      appSecret: REPLACE_IN_THE_CONFIGURATION_PAGE
```

| Field in `account` | Default | Meaning |
| --- | --- | --- |
| `appId` | empty | Enterprise self-built app ID. |
| `appSecret` | empty | Secret; redacted from settings responses. |
| `apiOrigin` | `https://open.feishu.cn` | Feishu or `https://open.larksuite.com`. Loopback HTTP is accepted for isolated tests only. |
| `locale` | `zh-CN` | Bot control messages, `zh-CN` or `en`; model answers retain their language. |
| `cwd` | `~/dsh-workspaces/feishu-im` | Expanded under the host user's home and created automatically; old empty strings use this default. Explicit paths must be absolute, exist, be readable/writable and remain outside the profile. Used as the initial directory of new chats only. |
| `allowedUsers` | `[]` | Explicit human open_ids. Empty means nobody can start tasks. |
| `legacyNamespace` | empty | Explicit pre-0.2 CLI profile name for deriving old conversation ids. Does not import credentials. |
| `maxConversations` | `4` | Maximum active private conversation workers; retained idle tasks do not count. |
| `maxPendingMessages` | `16` | Maximum queued tasks per conversation. |
| `maxConcurrentReplies` | `8` | Concurrent control/error replies. |
| `maxReplyBytes` | `12000` | UTF-8 bytes per complete Markdown post JSON content; range 64–16000. |
| `startupTimeoutMs` | `30000` | Initial connection readiness deadline. |
| `requestTimeoutMs` | `30000` | Deadline per HTTP request. |
| `taskTimeoutMs` | `600000` | Maximum task interval including tools and decisions. |
| `progressIntervalMs` | `1000` | Minimum interval between milestone snapshots; slow delivery coalesces pending updates. |
| `interactionTimeoutMs` | `300000` | Decision-card timeout; bounded further by task cancellation. |

Saving the same app on the page preserves existing authorizations; replacing the app clears them by default. With no authorized users, saving automatically displays a ten-minute, one-use `/dsh pair …` code. The user must still send it in the bot's private chat. After configuring the profile directly or using the CLI, generate a code on the page, or explicitly authorize with `allowedUsers` / `--allow-user`. No task runs without authorization.

Resource counts and millisecond limits must be positive integers. Changing an account cancels and joins the old channel, tasks and pending decisions before connecting the new one. Sessions remain on disk. Configuration writes use dsh settings revisions so stale editors cannot overwrite new credentials or authorization.

Completed and stopped tasks stay in Ungrouped, and ordinary messages continue the current task. `/dsh status` shows its directory. `/dsh cd` accepts absolute paths, paths relative to the current chat directory, and `~`; switching requires idle work. Changing configured `cwd` does not change existing chat directories.

The application namespace, chat id and human open_id identify a durable chat binding. Its initial Session id preserves compatibility with the former application/workspace/participants hash. `/dsh new` and `/dsh cd` switch to an independent Session while keeping previous tasks. `/dsh archive` uses the native dsh archive set. Bindings, directories, cross-task admission ids and unfinished archive intents live in the `feishu_im` storage domain, separate from model history. Back up that domain, Workspace state and Session storage together. The durable user message id remains `lark:<message_id>` for backwards deduplication compatibility. `legacyNamespace` only changes the application component of that hash; it cannot migrate preset composition or Session storage. A preset-free old Session requires its original preset-free deployment.

The optional management executable never starts an Agent:

```sh
# Run inside the installed profile via dsh. Provide the secret through stdin,
# not as a command-line argument. Replace paths/ids for your deployment.
secret-provider | dsh plugin --profile web exec feishu-im setup \
  --app-id cli_0123456789abcdef --secret-stdin \
  --workspace /absolute/task/workspace --allow-user ou_EXPLICIT_HUMAN

dsh plugin --profile web exec feishu-im doctor --json
dsh plugin --profile web exec feishu-im reset
```

`--workspace` is optional; omitting it creates and selects the default directory. Repeating setup for the same app without `--allow-user` preserves the profile's existing authorization list; replacing the app defaults to an empty list. To authorize explicitly, repeat `--allow-user` or separate multiple open_ids with commas.

`setup` also accepts `--locale`, `--lark` and `--legacy-namespace`. CLI edits require a dsh restart. Use the Web page for QR setup and live changes. `doctor` checks configuration, workspace and bot credentials without sending messages or opening the event connection. `reset` removes only this plugin's override and keeps Session history.

On older dsh, CLI `setup`, `doctor` and `reset` only manage or inspect the profile override, not saved Web settings. Once configured on the page, keep editing there and use **Disconnect and clear credentials** to remove the saved secret. Before upgrading dsh, record non-secret settings and reconfigure on the new page. The plugin does not automatically copy credentials between storage formats or convert host Session formats.
