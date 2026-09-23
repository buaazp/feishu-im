# Configuration

[中文](configuration.zh-CN.md) · [Quick start](../README.md)

Manage the profile with `dsh plugin --profile feishu exec feishu-im setup`. Setup merges only its own runner settings, preserving unrelated YAML rows, comments, and `!!js` expressions. It uses a lock, a private temporary file, and atomic replacement; an intervening edit causes an error. Stop dsh before changing its configuration, then restart it.

## Profile patch

The user patch normally lives at `~/.dsh/profiles/feishu/cordis.patch.yml`; a custom `DSH_HOME` changes the root. The bundle creates the runner. Setup configures it using this override:

```yaml
- id: headless-runner
  name: dsh-feishu-im
  disabled: false
  config:
    profile: YOUR_APP_PROFILE
    command: [lark-cli]
    cwd: /absolute/task/directory
    allowedUsers: [ou_YOUR_HUMAN_OPEN_ID]
    locale: en
```

`headless-runner` is the application-driver id recognized by dsh's startup auditor. The module is `dsh-feishu-im`; keep both names as shown. Do not add a second runner row. Use one dedicated profile for this bundle.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `profile` | Required | Existing lark-cli application profile, used for receipt and replies |
| `cwd` | Required | Absolute, existing task directory; launch dsh from here |
| `allowedUsers` | Required | Nonempty list of human `ou_...` open_ids for this app |
| `command` | `[lark-cli]` | Executable plus fixed arguments; no shell expansion |
| `locale` | `zh-CN` | Control replies: `zh-CN` or `en`; model answer language is unchanged |
| `maxConversations` | `4` | Simultaneous conversations |
| `maxPendingMessages` | `16` | Unstarted messages per conversation |
| `maxConcurrentReplies` | `8` | Concurrent control and failure replies |
| `maxRecordBytes` | `1048576` | Maximum CLI NDJSON record / collected RPC stream bytes |
| `maxReplyBytes` | `12000` | UTF-8 bytes in complete reply JSON content; range 64–16000 |
| `startupTimeoutMs` | `30000` | Deadline for the event-ready marker |
| `requestTimeoutMs` | `30000` | Deadline for each reply request |
| `taskTimeoutMs` | `600000` | Deadline for one submitted task, including continuations |
| `graceMs` | `3000` | Subprocess shutdown grace before managed termination |

Limits and durations are positive integers up to 2147483647, except the narrower reply-byte range. When queues or conversation slots are full, users must resend later. Control replies themselves may be dropped at their concurrency limit; the log records that condition.

Use `--allow-user` repeatedly or with comma-separated ids. Setup removes duplicates. A suggested logged-in identity becomes authorized only after an explicit prompt answer; noninteractive setup always requires the flag. Use `--lark-command /absolute/path/to/lark-cli` when a service manager has a different PATH.

Advanced settings are edited in YAML. The management commands validate literal runner mappings; dynamic expressions inside the runner configuration are for manual management and may not be readable by `doctor`. Unrelated rows containing expressions are preserved. Symlink patches are refused by setup; manage their targets yourself.

## Model and permissions

The plugin inherits model providers, credentials, tools, skills, and permissions from its dsh profile. It does not copy another profile's model selection. The base defaults to `deepseek-official / deepseek-flash`. Use dsh's credential store or supply `DEEPSEEK_API_KEY` through your environment; never commit keys into this repository or profile examples.

To use an already configured provider, add a separate override:

```yaml
- id: agent-default-model
  config:
    provider: YOUR_REGISTERED_PROVIDER
    model: YOUR_MODEL_ID
```

Provider registration and its credential reference must also exist in this profile. Follow the [Harness documentation](https://github.com/deepseek-ai/deepseek-harness) for provider-specific setup. `doctor` verifies only Feishu bot authentication, not model credentials or tool permissions.

The base workspace permission root comes from the directory where you launch dsh. Run `cd /absolute/task/directory` before `dsh --profile feishu`. Authorized senders share these permissions and this directory. The plugin does not provide remote tool-approval buttons. Keep a suitable permission policy for unattended work.

## Conversation continuity

The saved Session id depends on the lark-cli profile name, workspace path, private chat id, and sender id. Changing any of these selects a different history. Reinstalling the same plugin with the same settings and Session store preserves continuity. Uninstalling or resetting configuration does not delete Session files.
