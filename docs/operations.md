# Operations and troubleshooting

[中文](operations.zh-CN.md) · [Quick start](../README.md)

## Start, stop and supervise

Run from the configured task directory with `dsh --profile feishu`. Readiness is the log line `feishu-im: ready for private messages`; no fixed startup delay establishes readiness. Ctrl+C or SIGTERM cancels and drains owned work. The plugin keeps the consumer's stdin open and closes it for graceful shutdown. It does not stop a shared lark-cli event bus owned by other consumers.

A supervisor must run the same OS account that owns lark-cli credentials and have Node, pnpm, dsh, and lark-cli available. Set its working directory to `cwd`. Supply secrets through a protected environment file or dsh's credential store. A Linux user-service example is in [examples/feishu-im.service](../examples/feishu-im.service); edit its paths before use. No service is installed automatically.

Use one task-driving instance per app. Feishu delivery is not a distributed work queue: multiple listeners may compete or duplicate execution. Restart after configuration changes. The event transport handles reconnection through lark-cli; a failed consumer makes the dsh app exit nonzero so a supervisor can restart it.

## Diagnose a problem

```sh
dsh plugin --profile feishu exec feishu-im doctor
dsh plugin --profile feishu exec feishu-im doctor --json
lark-cli --profile YOUR_APP_PROFILE event status --json
```

`doctor` exits 0 only when configuration, directory access, and bot identity pass. It sends no messages and does not open a model or event connection. Check startup logs, then send `/dsh help` for a real round trip.

| Symptom | Action |
| --- | --- |
| Missing `pnpm` or `lark-cli` | Install the documented prerequisites; verify PATH under the service account. Setup accepts `--lark-command` for an absolute executable. |
| Bot unavailable, user token expired | Check `identities.bot` separately. Expired user OAuth is harmless for bot transport; fix bot credentials/capability instead of logging in as a user. |
| Permission denied / missing scopes | Enable the app scopes reported by lark-cli in the Feishu console and publish changes. Bot scopes do not use user OAuth login. |
| Remote event connection already exists | Stop the other listener normally. Do not force-stop another consumer. An idle bus you own can be stopped with `lark-cli --profile YOUR_APP_PROFILE event stop`. |
| No ready marker | Inspect dsh stderr for CLI startup, connection, authentication or subscription errors. Check the event's long-connection configuration. |
| Ready, but a message is ignored | Send a new private **text** message as an allowlisted human. Verify the app-specific open_id; bot messages, groups and attachments are ignored. Offline messages are not backfilled. |
| Acknowledgement, then task failure | Check model/provider credentials and dsh tool logs. Confirm dsh was launched from the configured task directory. |
| Task waits for tool approval | This release has no Feishu approval UI. Stop the task and review its permissions locally. |
| Result reply failed | Inspect the saved Session and logs before deciding whether to resend. Task side effects may already have happened; there is no automatic task replay or durable reply retry. |
| A second setup is reported | Wait for the active command. If it crashed, confirm no setup/reset process remains, then remove the empty `.feishu-im-setup.lock` directory inside this profile and retry. |
| Native helper or dependency build fails | Check the failed package's install diagnostics and dsh/pnpm build-approval guidance. Approve only the named necessary scripts; do not disable the sandbox or globally allow scripts as a workaround. |

Logs can contain task details, paths, message ids, and provider errors. Session files contain conversation and tool data. Redact these before sharing diagnostics; never paste credentials or raw authentication dumps into an issue.

## Delivery and recovery limits

A saved admission prevents reprocessing the same message id. It does not make arbitrary tool effects exactly once across a crash. In-memory waiting messages may be lost before admission; inspect the Session and resend intentionally. Interrupted admitted messages are not automatically rerun. A later new message resumes the history.

`/dsh stop` clears waiting messages and cancels active work, but cannot undo completed tool actions. Long answers are split into bounded plain-text messages with deterministic reply keys. Partial delivery remains possible if a later chunk fails.

## Upgrade and uninstall

Stop dsh, back up the profile's patch and Session store, and check the target release's [compatibility](compatibility.md). Install a new tarball through the same profile, run `doctor`, restart, and send a small task. dsh Session formats may change between releases; downgrading a plugin is not a promise that an older Harness can read newer Session data.

To remove the plugin, stop the process first:

```sh
dsh plugin --profile feishu exec feishu-im reset
dsh plugin --profile feishu remove dsh-feishu-im
```

Reset removes only the plugin-owned runner override. Uninstall removes the bundle dependency. Other profile settings and Session files are retained. A profile with the bundle installed but reset configuration intentionally fails startup until setup is run again.
