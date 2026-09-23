# Configuration

[中文](configuration.zh-CN.md) · [Quick start](../README.md)

The bundle inserts an additive `feishu-im` entry. Its `config.account` is one atomic, live setting. The dsh page verifies bot credentials before saving and stores the secret in the profile with mode `0600`. Keep the profile outside the bot's workspace and out of Git. Blank credentials leave the channel unconfigured without stopping dsh.

```yaml
- id: feishu-im
  config:
    account:
      appId: cli_0123456789abcdef
      appSecret: REPLACE_IN_THE_CONFIGURATION_PAGE
      cwd: /absolute/task/workspace
      allowedUsers:
        - ou_EXPLICIT_HUMAN
```

| Field in `account` | Default | Meaning |
| --- | --- | --- |
| `appId` | empty | Enterprise self-built app ID. |
| `appSecret` | empty | Secret; redacted from settings responses. |
| `apiOrigin` | `https://open.feishu.cn` | Feishu or `https://open.larksuite.com`. Loopback HTTP is accepted for isolated tests only. |
| `locale` | `zh-CN` | Bot control messages, `zh-CN` or `en`; model answers retain their language. |
| `cwd` | empty | Absolute task workspace; choose a readable/writable directory outside the profile. |
| `allowedUsers` | `[]` | Explicit human open_ids. Empty means nobody can start tasks. |
| `legacyNamespace` | empty | Explicit pre-0.2 CLI profile name for deriving old conversation ids. Does not import credentials. |
| `maxConversations` | `4` | Maximum active private conversation workers. |
| `maxPendingMessages` | `16` | Maximum queued tasks per conversation. |
| `maxConcurrentReplies` | `8` | Concurrent control/error replies. |
| `maxReplyBytes` | `12000` | UTF-8 bytes per text reply's JSON content; range 64–16000. |
| `startupTimeoutMs` | `30000` | Initial connection readiness deadline. |
| `requestTimeoutMs` | `30000` | Deadline per HTTP request. |
| `taskTimeoutMs` | `600000` | Maximum task interval including tools and decisions. |
| `progressIntervalMs` | `1000` | Minimum interval between milestone snapshots; slow delivery coalesces pending updates. |
| `interactionTimeoutMs` | `300000` | Decision-card timeout; bounded further by task cancellation. |

Resource counts and millisecond limits must be positive integers. Changing an account cancels and joins the old channel, tasks and pending decisions before connecting the new one. Sessions remain on disk. Configuration writes use dsh settings revisions so stale editors cannot overwrite new credentials or authorization.

The application id, workspace, chat id and human open_id determine a Session id. The durable user message id remains `lark:<message_id>` for backwards deduplication compatibility. `legacyNamespace` only changes the application component of that hash; it cannot migrate preset composition or Session storage. A preset-free old Session requires its original preset-free deployment.

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

`setup` also accepts `--locale`, `--lark` and `--legacy-namespace`. CLI edits require a dsh restart. Use the Web page for QR setup and live changes. `doctor` checks configuration, workspace and bot credentials without sending messages or opening the event connection. `reset` removes only this plugin's override and keeps Session history.
